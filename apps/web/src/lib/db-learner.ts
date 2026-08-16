import { and, eq, sql } from "drizzle-orm";
import {
  getDb,
  economy,
  events,
  learners,
  petState,
  worldState,
} from "@pal/db";
import type { Db } from "@pal/db";
import {
  applyAchievementFact,
  dailyLogCalendarStatus,
  earnedWeeklyRhythmCount,
  recordFirstWeeklyConfigurationMarker,
  recordImmediateDailyLogSettlement,
  recordPendingDailyLogReward,
  recordSemanticFact,
  semanticFactAlreadyRecorded,
  settlePendingDailyLogEvents,
  weeklyConfigurationDisposition,
  weeklyConfigurationRejection,
  type WeeklyConfigurationError,
} from "@/lib/achievement-state";
import {
  COLLECTION_SYNC,
  DAILY_LOG_REWARD_SETTLED,
  defaultRulePack,
  processEvent,
  PROGRESSION_POLICY,
  WEEKLY_RHYTHM_EARNED,
  type IncomingEvent,
  type LearnerState,
  type ProcessResult,
} from "@pal/engine";
import { ensureStoryPlanForEvent } from "@/lib/story-plan";
import {
  BEHAVIOR_TITLES,
  grantBehaviorTitle,
  grantStoryChapterForScheduleAdvance,
} from "@/lib/reward-grants";

// ---------------------------------------------------------------------------
// Learner lookup / creation  (by integration's external learner ID)
// ---------------------------------------------------------------------------

export async function getOrCreateLearnerIdentity(
  db: Db,
  integrationId: string,
  externalLearnerId: string
): Promise<string> {
  const [existing] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    )
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(learners)
    .values({ integrationId, externalLearnerId })
    .onConflictDoNothing()
    .returning({ id: learners.id });

  if (created) return created.id;

  // Another request created it concurrently
  const [retry] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    )
    .limit(1);

  if (!retry) throw new Error("Failed to create or find learner");
  return retry.id;
}

// ---------------------------------------------------------------------------
// State conversion between DB rows and engine types
// ---------------------------------------------------------------------------

function toLearnerState(
  eco: typeof economy.$inferSelect | undefined,
  pet: typeof petState.$inferSelect | undefined,
  world: typeof worldState.$inferSelect | undefined
): LearnerState {
  return {
    economy: {
      xp: eco?.xp ?? 0,
      xp_lifetime: eco?.xpLifetime ?? 0,
      level: eco?.level ?? 1,
      streak_current: eco?.streakCurrent ?? 0,
      streak_last_day: eco?.streakLastDay ?? null,
      last_event_at: eco?.lastEventAt?.toISOString() ?? null,
    },
    pet: {
      mood: pet?.mood ?? "neutral",
      mood_expires_at: pet?.moodExpiresAt?.toISOString() ?? null,
    },
    world: {
      stage: world?.stage ?? 0,
      unlocked_object_ids: world?.unlockedObjectIds ?? [],
    },
  };
}

function appendEngineEvent(
  result: ProcessResult,
  event: IncomingEvent,
): ProcessResult {
  const next = processEvent(event, result.state, defaultRulePack);
  return {
    state: next.state,
    mutations: [...result.mutations, ...next.mutations],
    trace: [...result.trace, ...next.trace],
    truncated: [...result.truncated, ...next.truncated],
  };
}

// ---------------------------------------------------------------------------
// Public API — replaces the in-memory learner-store.ts seam
// ---------------------------------------------------------------------------

export type ProcessEventResult =
  | { status: "duplicate" }
  | { status: "semantic_duplicate" }
  | { status: "rejected"; error: WeeklyConfigurationError }
  | { status: "processed"; result: ProcessResult };

/**
 * Processes an event in a single ACID transaction:
 * 1. Resolves the learner (creates on first use)
 * 2. Locks the learner row with SELECT ... FOR UPDATE
 * 3. Returns duplicate for an already-accepted delivery
 * 4. Rejects contradictory or invalid closed-period configuration
 * 5. Inserts the event — ON CONFLICT on (integration_id, idempotency_key)
 *    returns "duplicate" instead of applying the engine
 * 6. Inserts its semantically unique fact; a second source identity for the
 *    same behavior cannot change state
 * 7. Reads current economy / pet / world state and runs the rule engine
 * 8. Upserts state, scoped achievements, and reward notices
 * 9. Commits
 */
export async function processEventInDb(
  integrationId: string,
  externalLearnerId: string,
  event: IncomingEvent,
  idempotencyKey: string
): Promise<ProcessEventResult> {
  const db = getDb();

  return await db.transaction(async (tx) => {
    // 1. Get or create the learner inside the transaction so the lock works
    const learnerId = await getOrCreateLearnerIdentity(
      tx,
      integrationId,
      externalLearnerId,
    );

    // 2. Lock the learner row — serializes all writes for this learner
    await tx.execute(
      sql`SELECT id FROM ${learners} WHERE id = ${learnerId} FOR UPDATE`
    );

    // 3. Resolve an already-accepted delivery before any validation that reads
    // mutable learner state. Otherwise a lost-response retry could turn from
    // `processed` into a 422 after a delayed fact changes reconciliation state.
    const [acceptedDelivery] = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.integrationId, integrationId),
          eq(events.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (acceptedDelivery) {
      return { status: "duplicate" as const };
    }

    // A producer may accidentally assert the same source fact under a new
    // transport key. Resolve that immutable identity before validations that
    // depend on mutable learner state, so an accepted fact cannot later turn
    // into a rejection as delayed events arrive.
    if (
      await semanticFactAlreadyRecorded(tx, {
        learnerId,
        event,
        idempotencyKey,
      })
    ) {
      return { status: "semantic_duplicate" as const };
    }

    const activityDayStatus = await dailyLogCalendarStatus(
      tx,
      learnerId,
      event,
    );
    if (activityDayStatus === "invalid") {
      return {
        status: "rejected" as const,
        error: "inconsistent_activity_day" as const,
      };
    }
    if (activityDayStatus === "period-limit-exceeded") {
      return {
        status: "rejected" as const,
        error: "daily_log_period_limit_exceeded" as const,
      };
    }
    const configurationDisposition = await weeklyConfigurationDisposition(
      tx,
      learnerId,
      event,
    );
    const isFirstWeeklyConfiguration = configurationDisposition === "first";
    const configurationAdvances =
      configurationDisposition === "first" ||
      configurationDisposition === "higher";

    // 4. Reject contradictory/invalid closed-period configuration before the
    // event ledger. A closed period is immutable except for a narrowly scoped,
    // still-closed correction while delayed facts require reconciliation.
    const configurationError = await weeklyConfigurationRejection(
      tx,
      learnerId,
      event,
    );
    if (configurationError) {
      return {
        status: "rejected" as const,
        error: configurationError,
      };
    }

    // 5. The unique constraint remains the final delivery-idempotency guard.
    // The learner lock serializes this integration's normal per-learner path;
    // the constraint also handles a malformed key reused across learners.
    const [inserted] = await tx
      .insert(events)
      .values({
        integrationId,
        learnerId,
        idempotencyKey,
        eventType: event.event_type,
        occurredAt: new Date(event.occurred_at),
        metadata: event.metadata as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: events.id });

    if (!inserted) {
      return { status: "duplicate" as const };
    }

    // 6. Semantic dedup is independent from transport idempotency. For example,
    // two deliveries with different keys but the same learner/activity date
    // produce one daily-log fact and one set of effects.
    const fact = await recordSemanticFact(tx, {
      integrationId,
      learnerId,
      sourceEventId: inserted.id,
      event,
      idempotencyKey,
    });
    if (!fact) {
      return { status: "semantic_duplicate" as const };
    }
    if (isFirstWeeklyConfiguration) {
      await recordFirstWeeklyConfigurationMarker(tx, {
        integrationId,
        learnerId,
        sourceEventId: inserted.id,
        event,
      });
    }
    let dailyRewardSettled = false;
    if (activityDayStatus === "valid") {
      dailyRewardSettled = await recordImmediateDailyLogSettlement(tx, {
        integrationId,
        learnerId,
        sourceEventId: inserted.id,
        factId: fact.id,
        event,
      });
    } else if (activityDayStatus === "pending") {
      await recordPendingDailyLogReward(tx, {
        integrationId,
        learnerId,
        sourceEventId: inserted.id,
        factId: fact.id,
        event,
      });
    }

    // Calendar-bearing weekly facts create and bind the learner's immutable
    // term story schedule before an achievement can earn its collectible.
    await ensureStoryPlanForEvent(tx, learnerId, event);
    await grantStoryChapterForScheduleAdvance(tx, {
      learnerId,
      sourceFactId: fact.id,
      event,
      configurationAdvances,
    });

    // 7. Read current state
    const [eco] = await tx
      .select()
      .from(economy)
      .where(eq(economy.learnerId, learnerId))
      .limit(1);

    const [pet] = await tx
      .select()
      .from(petState)
      .where(eq(petState.learnerId, learnerId))
      .limit(1);

    const [world] = await tx
      .select()
      .from(worldState)
      .where(eq(worldState.learnerId, learnerId))
      .limit(1);

    const state = toLearnerState(eco, pet, world);

    // 8. Run the engine. A daily log received before configuration is durably
    // recorded but reward-pending. A durable settlement marker is the sole
    // authority to emit DAILY_LOG_REWARD_SETTLED, keeping flat XP exact-once and
    // independent from the forward-only streak chronology.
    let result: ProcessResult =
      activityDayStatus === "pending"
        ? { state, mutations: [], trace: [], truncated: [] }
        : processEvent(event, state, defaultRulePack);
    let rhythmBuilderTransitioned =
      state.economy.streak_current < 3 &&
      result.state.economy.streak_current >= 3;
    const appendAndTrackEconomyTransition = (nextEvent: IncomingEvent) => {
      const previousStreak = result.state.economy.streak_current;
      result = appendEngineEvent(result, nextEvent);
      if (
        previousStreak < 3 &&
        result.state.economy.streak_current >= 3
      ) {
        rhythmBuilderTransitioned = true;
      }
    };
    if (dailyRewardSettled) {
      appendAndTrackEconomyTransition({
        event_type: DAILY_LOG_REWARD_SETTLED,
        occurred_at: event.occurred_at,
        metadata: {},
      });
    }
    if (configurationAdvances) {
      const pendingEvents = await settlePendingDailyLogEvents(
        tx,
        learnerId,
        event,
      );
      for (const pendingEvent of pendingEvents) {
        appendAndTrackEconomyTransition(pendingEvent);
        appendAndTrackEconomyTransition({
          event_type: DAILY_LOG_REWARD_SETTLED,
          occurred_at: pendingEvent.occurred_at,
          metadata: {},
        });
      }
    }

    // Achievement transitions and economy progression share this transaction.
    // Only the first transition to an earned Weekly Rhythm emits the internal
    // progression event, so retries and configuration revisions cannot re-pay it.
    const achievementResult = await applyAchievementFact(
      tx,
      learnerId,
      fact,
      event,
    );
    if (achievementResult.weeklyRhythmEarnedCount !== undefined) {
      const progression = processEvent(
        {
          event_type: WEEKLY_RHYTHM_EARNED,
          occurred_at: event.occurred_at,
          metadata: {
            weekly_rhythm_count: achievementResult.weeklyRhythmEarnedCount,
          },
        },
        result.state,
        defaultRulePack,
      );
      result = {
        state: progression.state,
        mutations: [...result.mutations, ...progression.mutations],
        trace: [...result.trace, ...progression.trace],
        truncated: [...result.truncated, ...progression.truncated],
      };
    }
    const earnedCount = await earnedWeeklyRhythmCount(tx, learnerId);
    const missingMilestones = PROGRESSION_POLICY.collectionMilestones.filter(
      (milestone) =>
        earnedCount >= milestone.weeklyRhythms &&
        !result.state.world.unlocked_object_ids.includes(milestone.assetRefId),
    );
    for (const milestone of missingMilestones) {
      const collectionProgress = processEvent(
        {
          event_type: COLLECTION_SYNC,
          occurred_at: event.occurred_at,
          metadata: {
            weekly_rhythm_count: milestone.weeklyRhythms,
          },
        },
        result.state,
        defaultRulePack,
      );
      result = {
        state: collectionProgress.state,
        mutations: [...result.mutations, ...collectionProgress.mutations],
        trace: [...result.trace, ...collectionProgress.trace],
        truncated: [...result.truncated, ...collectionProgress.truncated],
      };
    }

    // 9. Upsert economy
    await tx
      .insert(economy)
      .values({
        learnerId,
        xp: result.state.economy.xp,
        xpLifetime: result.state.economy.xp_lifetime,
        level: result.state.economy.level,
        streakCurrent: result.state.economy.streak_current,
        streakLastDay: result.state.economy.streak_last_day,
        lastEventAt: result.state.economy.last_event_at
          ? new Date(result.state.economy.last_event_at)
          : null,
      })
      .onConflictDoUpdate({
        target: economy.learnerId,
        set: {
          xp: result.state.economy.xp,
          xpLifetime: result.state.economy.xp_lifetime,
          level: result.state.economy.level,
          streakCurrent: result.state.economy.streak_current,
          streakLastDay: result.state.economy.streak_last_day,
          lastEventAt: result.state.economy.last_event_at
            ? new Date(result.state.economy.last_event_at)
            : null,
          updatedAt: new Date(),
        },
      });

    if (rhythmBuilderTransitioned) {
      await grantBehaviorTitle(tx, {
        learnerId,
        titleId: BEHAVIOR_TITLES.rhythmBuilder.id,
        sourceFactId: fact.id,
      });
    }
    if (state.economy.level < 5 && result.state.economy.level >= 5) {
      await grantBehaviorTitle(tx, {
        learnerId,
        titleId: BEHAVIOR_TITLES.levelLeader.id,
        sourceFactId: fact.id,
      });
    }

    // 9. Upsert pet state
    await tx
      .insert(petState)
      .values({
        learnerId,
        mood: result.state.pet.mood,
        moodExpiresAt: result.state.pet.mood_expires_at
          ? new Date(result.state.pet.mood_expires_at)
          : null,
      })
      .onConflictDoUpdate({
        target: petState.learnerId,
        set: {
          mood: result.state.pet.mood,
          moodExpiresAt: result.state.pet.mood_expires_at
            ? new Date(result.state.pet.mood_expires_at)
            : null,
          updatedAt: new Date(),
        },
      });

    // 10. Upsert world state
    await tx
      .insert(worldState)
      .values({
        learnerId,
        stage: result.state.world.stage,
        unlockedObjectIds: result.state.world.unlocked_object_ids,
      })
      .onConflictDoUpdate({
        target: worldState.learnerId,
        set: {
          stage: result.state.world.stage,
          unlockedObjectIds: result.state.world.unlocked_object_ids,
          updatedAt: new Date(),
        },
      });

    return { status: "processed" as const, result };
  });
}

/**
 * Read-only: loads a learner's state from the DB for the world endpoint.
 * No lock, no transaction — just a read.
 */
export async function loadLearnerFromDb(
  integrationId: string,
  externalLearnerId: string
): Promise<LearnerState | null> {
  const db = getDb();

  const [learner] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    )
    .limit(1);

  if (!learner) return null;

  const [eco] = await db
    .select()
    .from(economy)
    .where(eq(economy.learnerId, learner.id))
    .limit(1);

  const [pet] = await db
    .select()
    .from(petState)
    .where(eq(petState.learnerId, learner.id))
    .limit(1);

  const [world] = await db
    .select()
    .from(worldState)
    .where(eq(worldState.learnerId, learner.id))
    .limit(1);

  return toLearnerState(eco, pet, world);
}

/**
 * Dev-only: deletes a learner and all cascaded state (events, economy,
 * pet_state, world_state). Used by the sandbox reset panel.
 */
export async function resetLearnerInDb(
  integrationId: string,
  externalLearnerId: string,
): Promise<void> {
  const db = getDb();

  await db
    .delete(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    );
}
