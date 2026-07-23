import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDb, type Db } from "@pal/db";
import { runMigrations } from "@pal/db";
import { sql } from "drizzle-orm";
import { integrations } from "@pal/db";
import {
  findOrCreateLearner,
  insertEvent,
  loadLearnerState,
  saveLearnerState,
  resetLearner,
} from "@/lib/db-learner";
import { defaultRulePack, processEvent } from "@pal/engine";
import type { IncomingEvent, LearnerState } from "@pal/engine";

// ── Setup ────────────────────────────────────────────────────────────────
//
// Requires a running Postgres on the TEST_DATABASE_URL from .env.local.
//   docker compose up -d postgres
//   pnpm --filter @pal/db migrate
//   pnpm --filter @pal/web test

const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://pal:pal@localhost:5433/pal_test";

let db: Db;
let integrationId: string;

// Clean slate between test files (not between every test — that's the suite's
// job if it needs it, but these tests are independent enough to share state).
async function truncateAll() {
  await db.execute(sql`TRUNCATE TABLE
    integrations, learners, events, economy, pet_state, world_state
    RESTART IDENTITY CASCADE`);
}

before(async () => {
  await runMigrations(TEST_URL);
  const { db: testDb } = createDb(TEST_URL, { statementTimeoutMs: 0 });
  db = testDb;
  await truncateAll();

  // Seed the sandbox integration so resolveIntegration / findOrCreateLearner work.
  const [row] = await db
    .insert(integrations)
    .values({
      slug: "sandbox",
      name: "Sandbox",
      secretHash: "unused-in-tests",
      allowedEventTypes: [
        "assignment.completed",
        "daily_checkin.created",
        "resource.viewed",
        "calendar.month_end",
        "calendar.semester_end",
      ],
    })
    .returning({ id: integrations.id });
  integrationId = row.id;
});

after(async () => {
  await truncateAll();
  // Pool is closed by the test runner's teardown; nothing extra needed.
});

// ── Helpers ──────────────────────────────────────────────────────────────

const EXTERNAL_ID = "test-learner-abc123";

function makeEvent(overrides?: Partial<IncomingEvent>): IncomingEvent {
  return {
    event_type: "daily_checkin.created",
    occurred_at: "2026-07-01T12:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("findOrCreateLearner", () => {
  it("creates a new learner and bootstraps state rows", async () => {
    const id = await findOrCreateLearner(db, integrationId, EXTERNAL_ID);
    assert.ok(id, "should return a UUID");

    // Verify bootstrap rows exist
    const econ = await db.execute(
      sql`SELECT xp, level, streak_current FROM economy WHERE learner_id = ${id}`
    );
    assert.ok(econ.rows[0], "economy row should exist");
    assert.equal(econ.rows[0].xp, 0);
    assert.equal(econ.rows[0].level, 1);

    const pet = await db.execute(
      sql`SELECT mood FROM pet_state WHERE learner_id = ${id}`
    );
    assert.ok(pet.rows[0], "pet_state row should exist");
    assert.equal(pet.rows[0].mood, "neutral");

    const world = await db.execute(
      sql`SELECT stage FROM world_state WHERE learner_id = ${id}`
    );
    assert.ok(world.rows[0], "world_state row should exist");
    assert.equal(world.rows[0].stage, 0);
  });

  it("returns the same ID for the same external learner", async () => {
    const id1 = await findOrCreateLearner(db, integrationId, EXTERNAL_ID);
    const id2 = await findOrCreateLearner(db, integrationId, EXTERNAL_ID);
    assert.equal(id1, id2);
  });
});

describe("insertEvent — idempotency", () => {
  const IDEM_KEY = "unique-key-001";

  it("inserts a new event and returns inserted", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "idemp-test-1");
    const result = await insertEvent(db, {
      integrationId,
      learnerId,
      idempotencyKey: IDEM_KEY,
      eventType: "daily_checkin.created",
      occurredAt: new Date("2026-07-01T12:00:00Z"),
      metadata: {},
    });
    assert.equal(result.status, "inserted");
    assert.ok(result.eventId);
  });

  it("returns duplicate for the same idempotency key", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "idemp-test-1");
    const result = await insertEvent(db, {
      integrationId,
      learnerId,
      idempotencyKey: IDEM_KEY,
      eventType: "daily_checkin.created",
      occurredAt: new Date("2026-07-01T12:00:00Z"),
      metadata: {},
    });
    assert.equal(result.status, "duplicate");
  });

  it("allows the same key under a different integration", async () => {
    // Create a second integration
    const [other] = await db
      .insert(integrations)
      .values({
        slug: "other-test",
        name: "Other Test",
        secretHash: "other-hash",
        allowedEventTypes: ["assignment.completed"],
      })
      .returning({ id: integrations.id });

    const learnerId = await findOrCreateLearner(db, other.id, "other-learner");
    const result = await insertEvent(db, {
      integrationId: other.id,
      learnerId,
      idempotencyKey: IDEM_KEY, // same key, different integration
      eventType: "assignment.completed",
      occurredAt: new Date("2026-07-01T12:00:00Z"),
      metadata: {},
    });
    assert.equal(result.status, "inserted", "same key under different integration should insert");
  });
});

describe("loadLearnerState / saveLearnerState round-trip", () => {
  it("loads initial state for a fresh learner", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "roundtrip-1");
    const state = await loadLearnerState(db, learnerId);
    assert.equal(state.economy.xp, 0);
    assert.equal(state.economy.level, 1);
    assert.equal(state.economy.streak_current, 0);
    assert.equal(state.pet.mood, "neutral");
    assert.equal(state.world.stage, 0);
    assert.deepEqual(state.world.unlocked_object_ids, []);
  });

  it("persists engine output and loads it back", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "roundtrip-2");
    const state = await loadLearnerState(db, learnerId);

    const event: IncomingEvent = {
      event_type: "assignment.completed",
      occurred_at: "2026-07-01T12:00:00.000Z",
      metadata: { on_time: true },
    };
    const result = processEvent(event, state, defaultRulePack);
    await saveLearnerState(db, learnerId, result.state);

    const loaded = await loadLearnerState(db, learnerId);
    assert.equal(loaded.economy.xp, 200);
    assert.equal(loaded.economy.xp_lifetime, 200);
    assert.equal(loaded.economy.level, 1);
    assert.equal(loaded.pet.mood, "happy");
  });
});

describe("resetLearner", () => {
  it("deletes the learner and all cascaded rows", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "reset-me");

    // Insert an event so we can verify cascade
    await insertEvent(db, {
      integrationId,
      learnerId,
      idempotencyKey: "reset-key",
      eventType: "daily_checkin.created",
      occurredAt: new Date(),
      metadata: {},
    });

    await resetLearner(integrationId, "reset-me");

    // Verify learner is gone
    const row = await db.execute(
      sql`SELECT id FROM learners WHERE id = ${learnerId}`
    );
    assert.equal(row.rows[0], undefined, "learner should be deleted");

    // Verify cascaded rows are gone
    const econ = await db.execute(
      sql`SELECT 1 FROM economy WHERE learner_id = ${learnerId}`
    );
    assert.equal(econ.rows[0], undefined, "economy should cascade-delete");

    const evt = await db.execute(
      sql`SELECT 1 FROM events WHERE learner_id = ${learnerId}`
    );
    assert.equal(evt.rows[0], undefined, "events should cascade-delete");
  });
});

describe("concurrent deduplication", () => {
  it("two concurrent inserts of the same key — only one succeeds", async () => {
    const learnerId = await findOrCreateLearner(db, integrationId, "concurrent-dedup");

    // Simulate two concurrent deliveries by running two transactions that
    // both try to insert the same idempotency key.
    const results = await Promise.allSettled([
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM economy WHERE learner_id = ${learnerId} FOR UPDATE`
        );
        return insertEvent(tx, {
          integrationId,
          learnerId,
          idempotencyKey: "concurrent-key",
          eventType: "daily_checkin.created",
          occurredAt: new Date(),
          metadata: {},
        });
      }),
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM economy WHERE learner_id = ${learnerId} FOR UPDATE`
        );
        return insertEvent(tx, {
          integrationId,
          learnerId,
          idempotencyKey: "concurrent-key",
          eventType: "daily_checkin.created",
          occurredAt: new Date(),
          metadata: {},
        });
      }),
    ]);

    const statuses = results.map((r) =>
      r.status === "fulfilled" ? r.value.status : "rejected"
    );

    assert.ok(
      statuses.includes("inserted"),
      "one should have inserted: " + JSON.stringify(statuses)
    );
    assert.ok(
      statuses.includes("duplicate"),
      "one should have been duplicate: " + JSON.stringify(statuses)
    );
  });
});
