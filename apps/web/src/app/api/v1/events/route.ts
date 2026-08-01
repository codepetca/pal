import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@pal/contract";
import type { IncomingEvent } from "@pal/engine";
import { identifyIntegration, resolveIntegration } from "@/lib/integration-auth";
import { processEventInDb } from "@/lib/db-learner";

// Clock-drift allowance when deciding whether an occurred_at is future-dated.
// Small on purpose: it only absorbs clock drift between an integration and us
// (minutes at worst), not timezones — occurred_at is an absolute instant. The
// rejection itself is UTC-day-granular to match the streak engine; see below.
const CLOCK_SKEW_MS = 60 * 60 * 1000;

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  const configuredIntegration = identifyIntegration(
    req.headers.get("authorization"),
  );
  if (!configuredIntegration) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const validation = v1.validateV1Event(await req.json());
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, detail: validation.detail },
      { status: 422 },
    );
  }
  const { event } = validation;

  const occurredAtMs = Date.parse(event.occurred_at);

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

  const engineEvent: IncomingEvent = {
    event_type: event.event_type,
    occurred_at: new Date(occurredAtMs).toISOString(),
    metadata: event.metadata,
  };
  const integration = await resolveIntegration(configuredIntegration);
  if (!integration.allowedEventTypes.includes(event.event_type)) {
    return NextResponse.json(
      {
        error: "unknown_event_type",
        detail: `${event.event_type} is not enabled for this integration`,
      },
      { status: 422 },
    );
  }

  // The engine decides what changes; processEventInDb runs the engine inside a
  // single ACID transaction with FOR UPDATE locking and constraint-based dedup.
  // Nothing else in the codebase is allowed to write learner state.
  const result = await processEventInDb(
    integration.id,
    event.learner_id,
    engineEvent,
    event.idempotency_key,
  );

  if (result.status === "duplicate") {
    return NextResponse.json({ status: "duplicate" });
  }

  if (result.result.truncated.length > 0) {
    // Belongs in the AuditLog once M1 lands. Until then it at least surfaces a rule
    // pack that cascades deeper than the engine will follow.
    console.warn(
      `[pal] cascade hit the depth limit for ${engineEvent.event_type}; dropped: ${result.result.truncated.join(", ")}`
    );
  }

  return NextResponse.json({
    status: "processed",
    mutations: result.result.mutations,
  });
}
