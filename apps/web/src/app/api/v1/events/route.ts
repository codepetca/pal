import { NextRequest, NextResponse } from "next/server";
import { v1 } from "@pal/contract";
import type { IncomingEvent } from "@pal/engine";
import { identifyIntegration, resolveIntegration } from "@/lib/integration-auth";
import { processEventInDb } from "@/lib/db-learner";
import { isPlausibleActivityDay } from "@/lib/activity-day";

// Clock-drift allowance when deciding whether an occurred_at is future-dated.
// Small on purpose: it only absorbs clock drift between an integration and us
// (minutes at worst), not timezones — occurred_at is an absolute instant. The
// rejection is instant-granular so same-day future hours are not admitted.
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
  const latestAllowedMs = Date.now() + CLOCK_SKEW_MS;

  // The engine is pure and forward-only, so ingest must keep future chronology
  // out. One hour absorbs integration clock drift without admitting later hours
  // merely because they share the server's UTC calendar date.
  if (occurredAtMs > latestAllowedMs) {
    return NextResponse.json({ error: "future_occurred_at" }, { status: 422 });
  }
  const eventUtcDay = new Date(occurredAtMs).toISOString().slice(0, 10);
  if (event.event_type === "daily_log.completed") {
    // Runtime validation above guarantees this field for daily-log events. The
    // contract's generic envelope does not preserve that metadata narrowing in
    // TypeScript, so retain a defensive property check here as well.
    const activityDay =
      "activity_day" in event.metadata
        ? String(event.metadata.activity_day)
        : eventUtcDay;
    // Before reading a configured period timezone, bound the claim to every date
    // that can exist at this instant anywhere in the IANA range (UTC-12..UTC+14).
    // The learner transaction performs the stricter configured-timezone check.
    if (!isPlausibleActivityDay(activityDay, occurredAtMs)) {
      return NextResponse.json(
        { error: "implausible_activity_day" },
        { status: 422 },
      );
    }
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

  if (
    result.status === "duplicate" ||
    result.status === "semantic_duplicate"
  ) {
    return NextResponse.json({ status: "duplicate" });
  }

  if (result.status === "rejected") {
    const detail = {
      closed_period_revision:
        "A closed Weekly Rhythm period cannot be revised",
      contradictory_period_configuration:
        "A closed Weekly Rhythm period cannot have fewer eligible days than stored completion facts",
      conflicting_period_calendar:
        "A period's term range and week position must remain stable and unique",
      inconsistent_activity_day:
        "The activity day does not match occurred_at in the configured term timezone",
      daily_log_period_limit_exceeded:
        "The version 1 period has exhausted its qualifying or correction daily-log capacity",
    }[result.error];
    return NextResponse.json(
      {
        error: result.error,
        detail,
      },
      { status: 422 },
    );
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
