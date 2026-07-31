import type { IncomingEvent } from "@pal/engine";

import { isIngestableEventType } from "./event-types";

// Absorbs modest integration clock drift around UTC midnight. The comparison
// below is day-granular because streak calculation uses UTC calendar days.
const CLOCK_SKEW_MS = 60 * 60 * 1000;

type ValidatedIngest = {
  event: IncomingEvent;
  idempotencyKey: string;
  learnerId: string;
};

type ValidationResult =
  | { ok: true; value: ValidatedIngest }
  | { ok: false; error: string };

export function validateIngestBody(
  body: unknown,
  now = Date.now(),
): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "missing_required_fields" };
  }

  const values = body as Record<string, unknown>;
  const idempotencyKey = values.idempotency_key;
  const learnerId = values.learner_id;
  const eventType = values.event_type;
  const occurredAt = values.occurred_at;

  if (
    typeof idempotencyKey !== "string" ||
    !idempotencyKey ||
    typeof learnerId !== "string" ||
    !learnerId ||
    typeof eventType !== "string" ||
    !eventType ||
    typeof occurredAt !== "string" ||
    !occurredAt
  ) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (!isIngestableEventType(eventType)) {
    return { ok: false, error: "unknown_event_type" };
  }

  const occurredAtMs = Date.parse(occurredAt);
  if (Number.isNaN(occurredAtMs)) {
    return { ok: false, error: "invalid_occurred_at" };
  }

  // Keep future days out at ingest. A future check-in would otherwise pin the
  // engine's forward-only streak date ahead of real activity until that day.
  const eventUtcDay = new Date(occurredAtMs).toISOString().slice(0, 10);
  const latestAllowedUtcDay = new Date(now + CLOCK_SKEW_MS)
    .toISOString()
    .slice(0, 10);
  if (eventUtcDay > latestAllowedUtcDay) {
    return { ok: false, error: "future_occurred_at" };
  }

  const metadata = values.metadata;
  return {
    ok: true,
    value: {
      idempotencyKey,
      learnerId,
      event: {
        event_type: eventType,
        occurred_at: new Date(occurredAtMs).toISOString(),
        metadata:
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : {},
      },
    },
  };
}
