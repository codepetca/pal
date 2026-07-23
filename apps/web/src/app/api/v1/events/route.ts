import { NextRequest, NextResponse } from "next/server";
import { defaultRulePack, processEvent, type IncomingEvent } from "@pal/engine";
import { getDb } from "@pal/db";
import { sql } from "drizzle-orm";
import { isIngestableEventType } from "@/lib/event-types";
import {
  findOrCreateLearner,
  insertEvent,
  loadLearnerState,
  resolveIntegration,
  saveLearnerState,
} from "@/lib/db-learner";

// Clock-drift allowance when deciding whether an occurred_at is future-dated.
// Small on purpose: it only absorbs clock drift between an integration and us
// (minutes at worst), not timezones — occurred_at is an absolute instant. The
// rejection itself is UTC-day-granular to match the streak engine; see below.
const CLOCK_SKEW_MS = 60 * 60 * 1000;

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  const integration = await resolveIntegration(req.headers.get("authorization"));
  if (!integration) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const { idempotency_key, learner_id, event_type, occurred_at, metadata } = body;

  if (!idempotency_key || !learner_id || !event_type || !occurred_at) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 422 });
  }

  if (!isIngestableEventType(event_type)) {
    return NextResponse.json({ error: "unknown_event_type" }, { status: 422 });
  }

  const occurredAtMs = Date.parse(occurred_at);
  if (Number.isNaN(occurredAtMs)) {
    return NextResponse.json({ error: "invalid_occurred_at" }, { status: 422 });
  }

  // Reject events dated on a future UTC day. The engine's streak guard is forward-only
  // and deliberately never self-heals, so a future-dated check-in that got in would pin
  // `streak_last_day` ahead of every real day and freeze the learner's streak — and
  // their check-in XP — until that date. The engine is pure and has no clock; keeping
  // poisoned days out is ingest's job.
  //
  // The comparison is UTC-day-granular to match the engine (an instant-level "not more
  // than N hours ahead" check would still admit a whole future UTC day). The skew term
  // means: the event's day may not be ahead of the day the server will be in within an
  // hour — so a slightly-fast integration clock just before UTC midnight still passes,
  // while anything a full day out is rejected.
  const eventUtcDay = new Date(occurredAtMs).toISOString().slice(0, 10);
  const latestAllowedUtcDay = new Date(Date.now() + CLOCK_SKEW_MS).toISOString().slice(0, 10);
  if (eventUtcDay > latestAllowedUtcDay) {
    return NextResponse.json({ error: "future_occurred_at" }, { status: 422 });
  }

  const event: IncomingEvent = {
    event_type,
    occurred_at: new Date(occurredAtMs).toISOString(),
    metadata: metadata ?? {},
  };

  const db = getDb();

  // The entire event-processing path runs inside a single transaction so that
  // the idempotency insert and the state writes are atomic. The learner row is
  // locked with FOR UPDATE to serialise concurrent events for the same learner.
  const result = await db.transaction(async (tx) => {
    const internalLearnerId = await findOrCreateLearner(tx, integration.id, learner_id);

    // Lock the learner's economy row so no concurrent event can interleave.
    // The economy row is the natural contention point — every event writes it.
    await tx.execute(
      sql`SELECT 1 FROM economy WHERE learner_id = ${internalLearnerId} FOR UPDATE`
    );

    // The UNIQUE constraint on (integration_id, idempotency_key) IS the
    // idempotency mechanism. No read-then-write check — the INSERT itself
    // either succeeds (new event) or gets a unique violation (duplicate).
    const insertResult = await insertEvent(tx, {
      integrationId: integration.id,
      learnerId: internalLearnerId,
      idempotencyKey: idempotency_key,
      eventType: event_type,
      occurredAt: new Date(occurredAtMs),
      metadata: metadata ?? {},
    });

    if (insertResult.status === "duplicate") {
      return { status: "duplicate" as const };
    }

    // The engine decides what changes; processEvent applies those changes and
    // feeds derived events back through the engine until the cascade settles.
    const state = await loadLearnerState(tx, internalLearnerId);
    const engineResult = processEvent(event, state, defaultRulePack);
    await saveLearnerState(tx, internalLearnerId, engineResult.state);

    if (engineResult.truncated.length > 0) {
      // Belongs in the AuditLog once M1 lands. Until then it at least surfaces
      // a rule pack that cascades deeper than the engine will follow.
      console.warn(
        `[pal] cascade hit the depth limit for ${event.event_type}; dropped: ${engineResult.truncated.join(", ")}`
      );
    }

    return {
      status: "processed" as const,
      mutations: engineResult.mutations,
    };
  });

  if (result.status === "duplicate") {
    return NextResponse.json({ status: "duplicate" });
  }

  return NextResponse.json({
    status: "processed",
    mutations: result.mutations,
  });
}
