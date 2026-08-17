// Zero-dependency validation for the version 1 event contract.
//
// Deliberately no schema library. This package is imported by producers (Pika's
// adapter) as well as by Pal's ingest, and a validation dependency here becomes
// a version conflict in someone else's app. The v1 contract is small and closed
// — six event types, flat metadata, no nesting — so hand-rolling costs less than
// it costs to share a dependency across two repos.
//
// What this file deliberately does NOT check:
//
//   * Whether `occurred_at` is in the future. That needs a clock, and a clock
//     makes the validator impure and untestable without freezing time. Ingest
//     owns that check — see the CLOCK_SKEW_MS note in the events route.
//   * Whether `idempotency_key` has been seen before. That needs storage and is
//     scoped per integration.
//   * Whether the asserted fact is true. Only the producer can know that.

import {
  SCHEMA_VERSION,
  V1_EVENT_TYPES,
  type V1Envelope,
  type V1Error,
  type V1EventType,
  type V1ValidationResult,
} from "./types";

// RFC 3986 unreserved characters. Tokens travel in URLs and log lines, so the
// contract keeps them free of anything needing escaping.
const URL_SAFE = /^[A-Za-z0-9._~-]+$/;

// RFC 3339 with a required UTC designator. Producers classify in the classroom's
// authoritative timezone and convert; Pal stores instants, never local time.
const RFC_3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/;

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const EVENT_TYPES = new Set<string>(V1_EVENT_TYPES);
const ENVELOPE_KEYS = [
  "schema_version",
  "idempotency_key",
  "learner_id",
  "event_type",
  "occurred_at",
  "metadata",
] as const;

function fail(error: V1Error, detail: string): V1ValidationResult {
  return { ok: false, error, detail };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isToken(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    URL_SAFE.test(value)
  );
}

// A calendar day that actually exists. `2026-02-30` matches the shape but is
// not a date, and a producer that emits one has a timezone bug worth surfacing
// rather than silently storing.
function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !CALENDAR_DAY.test(value)) return false;
  // PostgreSQL's date type has no year zero. Reject it at the shared public
  // boundary so an accepted event can never fail later during persistence.
  if (value.startsWith("0000-")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

type MetadataCheck = (metadata: Record<string, unknown>) => string | null;

type MetadataRule = {
  requiredKeys: string[];
  optionalKeys?: string[];
  check: MetadataCheck;
};

// Exactly the keys listed for each event type, and nothing else. Rejecting
// unknown keys is what keeps a well-meaning producer from quietly widening the
// privacy surface by attaching an assignment title "just for debugging".
const METADATA_RULES: Record<V1EventType, MetadataRule> = {
  "platform.session.started": {
    requiredKeys: [],
    check: () => null,
  },

  "classroom.joined": {
    requiredKeys: ["classroom_token"],
    check: (m) =>
      isToken(m.classroom_token, 128) ? null : "classroom_token must be 1-128 URL-safe characters",
  },

  "daily_log_week.configured": {
    requiredKeys: ["period_key", "config_version", "period_status", "eligible_days"],
    optionalKeys: [
      "term_token",
      "term_start_day",
      "term_end_day",
      "term_timezone",
      "term_week_count",
      "week_start_day",
      "week_index",
    ],
    check: (m) => {
      if (!isToken(m.period_key, 64)) return "period_key must be 1-64 URL-safe characters";
      if (!isInteger(m.config_version) || m.config_version < 1)
        return "config_version must be an integer >= 1";
      if (m.period_status !== "open" && m.period_status !== "closed")
        return "period_status must be 'open' or 'closed'";
      // Version 1 models a Monday-Friday daily-log week.
      if (!isInteger(m.eligible_days) || m.eligible_days < 0 || m.eligible_days > 5)
        return "eligible_days must be an integer 0-5";

      const v1CalendarKeys = [
        "term_token",
        "term_start_day",
        "term_end_day",
        "term_timezone",
        "week_index",
      ];
      const adaptiveCalendarKeys = [
        "term_week_count",
        "week_start_day",
      ];
      const calendarKeys = [...v1CalendarKeys, ...adaptiveCalendarKeys];
      const presentCalendarKeys = calendarKeys.filter((key) => m[key] !== undefined);
      const hasV1Calendar = v1CalendarKeys.every((key) => m[key] !== undefined);
      const hasAdaptiveCalendar = adaptiveCalendarKeys.every(
        (key) => m[key] !== undefined,
      );
      if (
        presentCalendarKeys.length !== 0 &&
        !(hasV1Calendar &&
          (presentCalendarKeys.length === v1CalendarKeys.length ||
            (hasAdaptiveCalendar && presentCalendarKeys.length === calendarKeys.length)))
      ) {
        return "send either the complete five-field v1 term calendar or all seven adaptive calendar fields";
      }
      if (hasV1Calendar) {
        if (!isToken(m.term_token, 128))
          return "term_token must be 1-128 URL-safe characters";
        if (!isCalendarDay(m.term_start_day))
          return "term_start_day must be a real YYYY-MM-DD date";
        if (!isCalendarDay(m.term_end_day))
          return "term_end_day must be a real YYYY-MM-DD date";
        if ((m.term_start_day as string) > (m.term_end_day as string))
          return "term_start_day must be on or before term_end_day";
        if (!isIanaTimeZone(m.term_timezone))
          return "term_timezone must be a valid IANA time zone";
        if (!hasAdaptiveCalendar) {
          if (!isInteger(m.week_index) || m.week_index < 1 || m.week_index > 16)
            return "week_index must be an integer 1-16 for a v1 term calendar";
          return null;
        }
        if (!isInteger(m.term_week_count) || m.term_week_count < 6 || m.term_week_count > 24)
          return "term_week_count must be an integer 6-24";
        if (!isCalendarDay(m.week_start_day))
          return "week_start_day must be a real YYYY-MM-DD date";
        if (m.week_start_day < m.term_start_day || m.week_start_day > m.term_end_day)
          return "week_start_day must fall within the term date range";
        if (!isInteger(m.week_index) || m.week_index < 1 || m.week_index > m.term_week_count)
          return "week_index must be an integer within term_week_count";
      }
      return null;
    },
  },

  "daily_log.completed": {
    requiredKeys: ["period_key", "activity_day"],
    check: (m) => {
      if (!isToken(m.period_key, 64)) return "period_key must be 1-64 URL-safe characters";
      if (!isCalendarDay(m.activity_day)) return "activity_day must be a real YYYY-MM-DD date";
      return null;
    },
  },

  "learning_item.viewed": {
    requiredKeys: ["item_token", "kind", "period_key", "timing"],
    check: (m) => {
      if (!isToken(m.item_token, 128)) return "item_token must be 1-128 URL-safe characters";
      if (m.kind !== "assignment") return "kind must be 'assignment' in version 1";
      if (!isToken(m.period_key, 64)) return "period_key must be 1-64 URL-safe characters";
      if (m.timing !== "within_24h_of_release" && m.timing !== "later")
        return "timing must be 'within_24h_of_release' or 'later'";
      return null;
    },
  },

  "learning_item.completed": {
    requiredKeys: ["item_token", "kind", "period_key", "timing"],
    check: (m) => {
      if (!isToken(m.item_token, 128)) return "item_token must be 1-128 URL-safe characters";
      if (m.kind !== "assignment") return "kind must be 'assignment' in version 1";
      if (!isToken(m.period_key, 64)) return "period_key must be 1-64 URL-safe characters";
      if (m.timing !== "on_time" && m.timing !== "late")
        return "timing must be 'on_time' or 'late'";
      return null;
    },
  },
};

/**
 * Validate an unknown payload against version 1 of the event contract.
 *
 * Returns a discriminated union rather than throwing, because both callers want
 * the failure as a value: ingest turns it into a 422 body, and a producer's
 * outbox marks the record non-retryable and moves on.
 */
export function validateV1Event(payload: unknown): V1ValidationResult {
  if (!isPlainObject(payload)) {
    return fail("missing_required_fields", "payload must be a JSON object");
  }

  const unexpectedEnvelopeKeys = Object.keys(payload).filter(
    (key) => !ENVELOPE_KEYS.includes(key as (typeof ENVELOPE_KEYS)[number])
  );
  if (unexpectedEnvelopeKeys.length > 0) {
    return fail(
      "invalid_envelope",
      `version 1 does not allow envelope keys: ${unexpectedEnvelopeKeys.join(", ")}`
    );
  }

  // Version first. An unsupported version means the rest of the shape is not
  // ours to interpret, and the producer should stop retrying rather than
  // reformat the body.
  if (payload.schema_version !== SCHEMA_VERSION) {
    return fail(
      "unsupported_schema_version",
      `schema_version must be ${SCHEMA_VERSION}, received ${JSON.stringify(payload.schema_version)}`
    );
  }

  for (const field of ["idempotency_key", "learner_id", "event_type", "occurred_at"]) {
    if (payload[field] === undefined || payload[field] === null) {
      return fail("missing_required_fields", `${field} is required`);
    }
  }

  // Not URL-safe-constrained: the contract allows readable prefixes like
  // "pika:assignment:<token>". The embedded tokens still have to be opaque, but
  // that is the producer's guarantee and not something Pal can verify.
  const key = payload.idempotency_key;
  if (typeof key !== "string" || key.length < 1 || key.length > 200) {
    return fail("invalid_idempotency_key", "idempotency_key must be a string of 1-200 characters");
  }

  if (!isToken(payload.learner_id, 128)) {
    return fail("invalid_learner_id", "learner_id must be 1-128 URL-safe characters");
  }

  if (typeof payload.event_type !== "string" || !EVENT_TYPES.has(payload.event_type)) {
    return fail(
      "unknown_event_type",
      `event_type must be one of: ${V1_EVENT_TYPES.join(", ")}`
    );
  }
  const eventType = payload.event_type as V1EventType;

  if (typeof payload.occurred_at !== "string" || !RFC_3339_UTC.test(payload.occurred_at)) {
    return fail("invalid_occurred_at", "occurred_at must be an RFC 3339 UTC timestamp");
  }
  if (Number.isNaN(Date.parse(payload.occurred_at))) {
    return fail("invalid_occurred_at", "occurred_at is not a real instant");
  }

  if (!isPlainObject(payload.metadata)) {
    return fail("invalid_metadata", "metadata must be a JSON object");
  }

  const rule = METADATA_RULES[eventType];
  const present = Object.keys(payload.metadata);
  const allowed = [...rule.requiredKeys, ...(rule.optionalKeys ?? [])];

  const unexpected = present.filter((k) => !allowed.includes(k));
  if (unexpected.length > 0) {
    return fail(
      "invalid_metadata",
      `${eventType} does not allow metadata keys: ${unexpected.join(", ")}`
    );
  }

  const missing = rule.requiredKeys.filter((k) => !present.includes(k));
  if (missing.length > 0) {
    return fail("invalid_metadata", `${eventType} requires metadata keys: ${missing.join(", ")}`);
  }

  const problem = rule.check(payload.metadata);
  if (problem !== null) {
    return fail("invalid_metadata", problem);
  }

  // Return a freshly closed envelope as defense in depth. Even if this
  // validator is later changed to tolerate an input detail, an accepted value
  // cannot forward fields outside the versioned privacy contract.
  return {
    ok: true,
    event: {
      schema_version: SCHEMA_VERSION,
      idempotency_key: key,
      learner_id: payload.learner_id,
      event_type: eventType,
      occurred_at: payload.occurred_at,
      metadata: payload.metadata,
    } as V1Envelope,
  };
}

/** True when a payload declares a version this package can validate. */
export function isV1Payload(payload: unknown): boolean {
  return isPlainObject(payload) && payload.schema_version === SCHEMA_VERSION;
}
