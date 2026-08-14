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
  weeklyConfigurationExists,
  weeklyConfigurationRejection,
  type WeeklyConfigurationError,
} from "@/lib/achievement-state";
import {
  COLLECTION_SYNC,
  defaultRulePack,
  processEvent,
  PROGRESSION_POLICY,
  STREAK_MILESTONE,
  WEEKLY_RHYTHM_EARNED,
  type IncomingEvent,
  type LearnerState,
  type ProcessResult,
} from "@pal/engine";

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
    const isFirstWeeklyConfiguration =
      event.event_type === "daily_log_week.configured" &&
      !(await weeklyConfigurationExists(tx, learnerId, event));

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
    if (activityDayStatus === "valid") {
      await recordImmediateDailyLogSettlement(tx, {
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

    // 8. Run the engine. A daily log received before its first weekly
    // configuration is durably recorded but remains reward-pending: the first
    // configuration settles only facts that agree with its authoritative
    // timezone (or all facts under the legacy calendar-less contract).
    let result: ProcessResult =
      activityDayStatus === "pending"
        ? { state, mutations: [], trace: [], truncated: [] }
        : processEvent(event, state, defaultRulePack);
    if (isFirstWeeklyConfiguration) {
      const pendingEvents = await settlePendingDailyLogEvents(
        tx,
        learnerId,
        event,
      );
      for (const pendingEvent of pendingEvents) {
        const lifetimeXpBefore = result.state.economy.xp_lifetime;
        const settlement = processEvent(
          pendingEvent,
          result.state,
          defaultRulePack,
        );
        result = {
          state: settlement.state,
          mutations: [...result.mutations, ...settlement.mutations],
          trace: [...result.trace, ...settlement.trace],
          truncated: [...result.truncated, ...settlement.truncated],
        };
        // A delayed valid fact still earns its flat daily reward exactly once
        // even when a newer day already anchors the forward-only rhythm. The
        // historical source event remains unable to move the streak backward.
        if (result.state.economy.xp_lifetime === lifetimeXpBefore) {
          const dailyReward = processEvent(
            {
              event_type: STREAK_MILESTONE,
              occurred_at: pendingEvent.occurred_at,
              metadata: {},
            },
            result.state,
            defaultRulePack,
          );
          result = {
            state: dailyReward.state,
            mutations: [...result.mutations, ...dailyReward.mutations],
            trace: [...result.trace, ...dailyReward.trace],
            truncated: [...result.truncated, ...dailyReward.truncated],
          };
        }
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
