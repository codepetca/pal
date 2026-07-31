import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  getDb,
  economy,
  events,
  integrations,
  learners,
  petState,
  worldState,
} from "@pal/db";
import type { Db } from "@pal/db";
import {
  defaultRulePack,
  processEvent,
  type IncomingEvent,
  type LearnerState,
  type ProcessResult,
} from "@pal/engine";

// The sandbox integration slug. In M1 this becomes configurable per-integration.
const SANDBOX_SLUG = "sandbox";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// ---------------------------------------------------------------------------
// Integration lookup / creation
// ---------------------------------------------------------------------------

async function getOrCreateIntegration(db: Db): Promise<string> {
  const secret = process.env.SANDBOX_INTEGRATION_SECRET;
  if (!secret) throw new Error("SANDBOX_INTEGRATION_SECRET is not set");

  const [existing] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.slug, SANDBOX_SLUG))
    .limit(1);

  if (existing) return existing.id;

  // Create on first use. If two requests race, the unique constraint catches
  // the second and we fall through to the select below.
  const [created] = await db
    .insert(integrations)
    .values({
      slug: SANDBOX_SLUG,
      name: "Sandbox",
      secretHash: hashSecret(secret),
      allowedEventTypes: [
        "platform.session.started",
        "classroom.joined",
        "daily_log_week.configured",
        "daily_log.completed",
        "learning_item.viewed",
        "learning_item.completed",
      ],
    })
    .onConflictDoNothing()
    .returning({ id: integrations.id });

  if (created) return created.id;

  const [retry] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(eq(integrations.slug, SANDBOX_SLUG))
    .limit(1);

  if (!retry) throw new Error("Failed to create or find sandbox integration");
  return retry.id;
}

// ---------------------------------------------------------------------------
// Learner lookup / creation  (by integration's external learner ID)
// ---------------------------------------------------------------------------

async function getOrCreateLearner(
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
  | { status: "processed"; result: ProcessResult };

/**
 * Processes an event in a single ACID transaction:
 * 1. Resolves the sandbox integration (creates on first use)
 * 2. Resolves the learner (creates on first use)
 * 3. Locks the learner row with SELECT ... FOR UPDATE
 * 4. Inserts the event — ON CONFLICT on (integration_id, idempotency_key)
 *    returns "duplicate" instead of applying the engine
 * 5. Reads current economy / pet / world state
 * 6. Runs the rule engine
 * 7. Upserts economy, pet_state, world_state
 * 8. Commits
 */
export async function processEventInDb(
  externalLearnerId: string,
  event: IncomingEvent,
  idempotencyKey: string
): Promise<ProcessEventResult> {
  const db = getDb();
  const integrationId = await getOrCreateIntegration(db);

  return await db.transaction(async (tx) => {
    // 1. Get or create the learner inside the transaction so the lock works
    const learnerId = await getOrCreateLearner(tx, integrationId, externalLearnerId);

    // 2. Lock the learner row — serializes all writes for this learner
    await tx.execute(
      sql`SELECT id FROM ${learners} WHERE id = ${learnerId} FOR UPDATE`
    );

    // 3. Idempotency check via unique constraint — atomic with the state write
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

    // 4. Read current state
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

    // 5. Run the engine
    const result = processEvent(event, state, defaultRulePack);

    // 6. Upsert economy
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

    // 7. Upsert pet state
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

    // 8. Upsert world state
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
  externalLearnerId: string
): Promise<LearnerState | null> {
  const db = getDb();
  const integrationId = await getOrCreateIntegration(db);

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
export async function resetLearnerInDb(externalLearnerId: string): Promise<void> {
  const db = getDb();
  const integrationId = await getOrCreateIntegration(db);

  await db
    .delete(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    );
}

/**
 * Dev-only: resets the learner's economy to level 1 / 0 XP and clears pet mood
 * and world stage, without deleting the learner or event history. Used by the
 * sandbox "Reset XP & level" button.
 */
export async function resetEconomyInDb(externalLearnerId: string): Promise<void> {
  const db = getDb();
  const integrationId = await getOrCreateIntegration(db);

  const [learner] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    )
    .limit(1);

  if (!learner) return;

  await db
    .update(economy)
    .set({
      xp: 0,
      xpLifetime: 0,
      level: 1,
      streakCurrent: 0,
      streakLastDay: null,
      updatedAt: new Date(),
    })
    .where(eq(economy.learnerId, learner.id));

  await db
    .update(petState)
    .set({
      mood: "neutral",
      moodExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(petState.learnerId, learner.id));

  await db
    .update(worldState)
    .set({
      stage: 0,
      unlockedObjectIds: [],
      updatedAt: new Date(),
    })
    .where(eq(worldState.learnerId, learner.id));
}