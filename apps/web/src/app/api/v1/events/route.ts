import { NextRequest, NextResponse } from "next/server";
import { defaultRulePack, processEvent, type IncomingEvent } from "@pal/engine";
import { isAuthorizedIngest } from "@/lib/ingest-auth";
import { isIngestableEventType } from "@/lib/event-types";
import {
  hasProcessedEvent,
  loadLearner,
  recordProcessedEvent,
  saveLearner,
} from "@/lib/learner-store";

// Clock-drift allowance when deciding whether an occurred_at is future-dated.
// Small on purpose: it only absorbs clock drift between an integration and us
// (minutes at worst), not timezones — occurred_at is an absolute instant. The
// rejection itself is UTC-day-granular to match the streak engine; see below.
const CLOCK_SKEW_MS = 60 * 60 * 1000;

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  if (!isAuthorizedIngest(req.headers.get("authorization"))) {
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

  if (hasProcessedEvent(idempotency_key)) {
    return NextResponse.json({ status: "duplicate" });
  }

  const event: IncomingEvent = {
    event_type,
    occurred_at: new Date(occurredAtMs).toISOString(),
    metadata: metadata ?? {},
  };

  // The engine decides what changes; processEvent applies those changes and feeds the
  // derived events back through the engine until the cascade settles. Nothing else in
  // the codebase is allowed to write learner state.
  const state = loadLearner(learner_id);
  const result = processEvent(event, state, defaultRulePack);
  saveLearner(learner_id, result.state);

  // Record the key only after the state change is persisted. If anything above threw,
  // the key was never recorded and a retry reprocesses the event instead of getting a
  // spurious "duplicate" and losing the update. Keep this immediately after the save,
  // and keep the whole stretch from `hasProcessedEvent` to here free of `await` — the
  // check/record pair is not atomic, and only the synchronous path prevents two
  // concurrent deliveries of the same key from both applying (see learner-store.ts).
  recordProcessedEvent(idempotency_key);

  if (result.truncated.length > 0) {
    // Belongs in the AuditLog once M1 lands. Until then it at least surfaces a rule
    // pack that cascades deeper than the engine will follow.
    console.warn(
      `[pal] cascade hit the depth limit for ${event.event_type}; dropped: ${result.truncated.join(", ")}`
    );
  }

  return NextResponse.json({
    status: "processed",
    mutations: result.mutations,
  });
}
