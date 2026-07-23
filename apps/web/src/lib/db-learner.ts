import { eq, sql } from "drizzle-orm";
import type { LearnerState } from "@pal/engine";
import { getDb, type Db } from "@pal/db";
import { economy, events, integrations, learners, petState, worldState } from "@pal/db";
import { timingSafeEqual } from "node:crypto";

// ── Integration resolution ──────────────────────────────────────────────

export type ResolvedIntegration = {
  id: string;
  slug: string;
  rulePackId: string;
};

/** Looks up an integration by its Bearer token. Returns null if not found. */
export async function resolveIntegration(
  authHeader: string | null
): Promise<ResolvedIntegration | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const presented = authHeader.slice("Bearer ".length);

  const secret = process.env.SANDBOX_INTEGRATION_SECRET;
  if (!secret) return null;

  // Constant-time comparison against the configured secret.
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Look up the integration row. In production the secret hash is the lookup
  // key; for the sandbox we match by slug after validating the shared secret.
  const db = getDb();
  const rows = await db
    .select({ id: integrations.id, slug: integrations.slug, rulePackId: integrations.rulePackId })
    .from(integrations)
    .where(eq(integrations.slug, "sandbox"))
    .limit(1);

  return rows[0] ?? null;
}

// ── Learner resolution ──────────────────────────────────────────────────

/** Finds an existing learner or creates one. Returns the internal UUID. */
export async function findOrCreateLearner(
  db: Db,
  integrationId: string,
  externalLearnerId: string
): Promise<string> {
  const existing = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
    )
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const [created] = await db
    .insert(learners)
    .values({ integrationId, externalLearnerId })
    .returning({ id: learners.id });

  // Bootstrap the economy, pet, and world rows so the learner is ready to
  // receive events immediately.
  await db.insert(economy).values({ learnerId: created.id });
  await db.insert(petState).values({ learnerId: created.id });
  await db.insert(worldState).values({ learnerId: created.id });

  return created.id;
}

// ── State load / save ───────────────────────────────────────────────────

/** Reads the full LearnerState for the engine from the three state tables. */
export async function loadLearnerState(db: Db, learnerId: string): Promise<LearnerState> {
  const [econ, pet, world] = await Promise.all([
    db.select().from(economy).where(eq(economy.learnerId, learnerId)).limit(1),
    db.select().from(petState).where(eq(petState.learnerId, learnerId)).limit(1),
    db.select().from(worldState).where(eq(worldState.learnerId, learnerId)).limit(1),
  ]);

  return {
    economy: {
      xp: econ[0]?.xp ?? 0,
      xp_lifetime: econ[0]?.xpLifetime ?? 0,
      level: econ[0]?.level ?? 1,
      streak_current: econ[0]?.streakCurrent ?? 0,
      streak_last_day: econ[0]?.streakLastDay ?? null,
      last_event_at: econ[0]?.lastEventAt?.toISOString() ?? null,
    },
    pet: {
      mood: pet[0]?.mood ?? "neutral",
      mood_expires_at: pet[0]?.moodExpiresAt?.toISOString() ?? null,
    },
    world: {
      stage: world[0]?.stage ?? 0,
      unlocked_object_ids: world[0]?.unlockedObjectIds ?? [],
    },
  };
}

/** Writes the engine's LearnerState back to the three state tables. */
export async function saveLearnerState(
  db: Db,
  learnerId: string,
  state: LearnerState
): Promise<void> {
  await Promise.all([
    db
      .update(economy)
      .set({
        xp: state.economy.xp,
        xpLifetime: state.economy.xp_lifetime,
        level: state.economy.level,
        streakCurrent: state.economy.streak_current,
        streakLastDay: state.economy.streak_last_day,
        lastEventAt: state.economy.last_event_at
          ? new Date(state.economy.last_event_at)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(economy.learnerId, learnerId)),
    db
      .update(petState)
      .set({
        mood: state.pet.mood,
        moodExpiresAt: state.pet.mood_expires_at
          ? new Date(state.pet.mood_expires_at)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(petState.learnerId, learnerId)),
    db
      .update(worldState)
      .set({
        stage: state.world.stage,
        unlockedObjectIds: state.world.unlocked_object_ids,
        updatedAt: new Date(),
      })
      .where(eq(worldState.learnerId, learnerId)),
  ]);
}

// ── Idempotent event insert ─────────────────────────────────────────────

export type InsertEventResult =
  | { status: "inserted"; eventId: string }
  | { status: "duplicate" };

/**
 * Inserts an event row. The UNIQUE constraint on (integration_id, idempotency_key)
 * IS the idempotency mechanism — no read-then-write check that could race.
 *
 * Must be called inside a transaction that also holds a FOR UPDATE lock on the
 * learner row, so that a duplicate arriving concurrently with the first insert
 * sees the committed event row and gets a constraint violation.
 */
export async function insertEvent(
  db: Db,
  params: {
    integrationId: string;
    learnerId: string;
    idempotencyKey: string;
    eventType: string;
    occurredAt: Date;
    metadata: Record<string, unknown>;
  }
): Promise<InsertEventResult> {
  try {
    const [row] = await db
      .insert(events)
      .values({
        integrationId: params.integrationId,
        learnerId: params.learnerId,
        idempotencyKey: params.idempotencyKey,
        eventType: params.eventType,
        occurredAt: params.occurredAt,
        metadata: params.metadata,
      })
      .returning({ id: events.id });

    return { status: "inserted", eventId: row.id };
  } catch (err: unknown) {
    // PostgreSQL code 23505 = unique_violation. The only unique constraint on
    // this table is events_integration_idempotency_uq, so a violation means
    // this idempotency key was already processed.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return { status: "duplicate" };
    }
    throw err;
  }
}

// ── Dev-only reset ──────────────────────────────────────────────────────

/** Deletes all state for a learner. Dev sandbox only. */
export async function resetLearner(
  integrationId: string,
  externalLearnerId: string
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: learners.id })
      .from(learners)
      .where(
        sql`${learners.integrationId} = ${integrationId} AND ${learners.externalLearnerId} = ${externalLearnerId}`
      )
      .limit(1);

    if (rows.length === 0) return;

    // CASCADE handles economy, pet_state, world_state, and events.
    await tx.delete(learners).where(eq(learners.id, rows[0].id));
  });
}