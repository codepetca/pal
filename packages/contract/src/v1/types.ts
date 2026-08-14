// Version 1 of the integration event contract.
//
// This file is the machine-readable form of the "Canonical version 1 contract"
// section of docs/pika-signal-adapter.md. Where the two disagree, this file is
// correct and the doc is a bug.
//
// An integration (Pika first, ClassOS later) asserts a privacy-safe *fact* by
// delivering an *event*. The distinction matters: an event is one delivery and
// may be a duplicate; the fact is what it asserts. Pal deduplicates events into
// qualified facts before any achievement rule sees them.

export const SCHEMA_VERSION = 1 as const;

// The six facts an integration may assert in version 1. Adding a name here is
// additive (no consumer expects it yet) and does NOT bump SCHEMA_VERSION — see
// the versioning policy in this package's README.
export const V1_EVENT_TYPES = [
  "platform.session.started",
  "classroom.joined",
  "daily_log_week.configured",
  "daily_log.completed",
  "learning_item.viewed",
  "learning_item.completed",
] as const;

export type V1EventType = (typeof V1_EVENT_TYPES)[number];

// Pal never derives the academic calendar from delivery time, so the producer
// names the week the behavior belongs to.
export type PeriodKey = string;

// An opaque, integration-scoped token. Reversible only with the producer's
// private mapping — never a raw Pika user, classroom, or assignment id.
export type OpaqueToken = string;

type LegacyTermCalendar = {
  term_token?: never;
  term_start_day?: never;
  term_end_day?: never;
  term_timezone?: never;
  term_week_count?: never;
  week_start_day?: never;
  week_index?: never;
};

type V1TermCalendar = {
  term_token: OpaqueToken;
  term_start_day: string;
  term_end_day: string;
  term_timezone: string;
  term_week_count?: never;
  week_start_day?: never;
  week_index: number;
};

type AdaptiveTermCalendar = {
  term_token: OpaqueToken;
  term_start_day: string;
  term_end_day: string;
  term_timezone: string;
  term_week_count: number;
  week_start_day: string;
  week_index: number;
};

export type V1Metadata = {
  // A genuine authenticated learner session. Pal derives "first login"; the
  // producer does not claim it.
  "platform.session.started": Record<string, never>;

  // A newly created enrolment. Revisiting an existing enrolment is not a join.
  "classroom.joined": {
    classroom_token: OpaqueToken;
  };

  // How many daily-log opportunities the learner actually had that week.
  // Sent automatically for every active learner, including zero-opportunity
  // weeks, so Pal can tell "no opportunity" from "missed it".
  "daily_log_week.configured": {
    period_key: PeriodKey;
    config_version: number;
    period_status: "open" | "closed";
    eligible_days: number;
  } & (LegacyTermCalendar | V1TermCalendar | AdaptiveTermCalendar);

  // At least one qualifying log on that date. One fact per learner/date, even
  // when the learner logged in several classrooms.
  "daily_log.completed": {
    period_key: PeriodKey;
    activity_day: string;
  };

  // The first genuine learner-initiated open of an item. Background fetches,
  // preloads, and later reopens do not qualify.
  "learning_item.viewed": {
    item_token: OpaqueToken;
    kind: "assignment";
    period_key: PeriodKey;
    timing: "within_24h_of_release" | "later";
  };

  // The first authoritative valid completion. Unsubmit/resubmit does not
  // produce a second version 1 fact.
  "learning_item.completed": {
    item_token: OpaqueToken;
    kind: "assignment";
    period_key: PeriodKey;
    timing: "on_time" | "late";
  };
};

export type V1Envelope<T extends V1EventType = V1EventType> = {
  schema_version: typeof SCHEMA_VERSION;
  idempotency_key: string;
  learner_id: OpaqueToken;
  event_type: T;
  occurred_at: string;
  metadata: V1Metadata[T];
};

// Convenience aliases for producers building one specific fact.
export type SessionStartedEvent = V1Envelope<"platform.session.started">;
export type ClassroomJoinedEvent = V1Envelope<"classroom.joined">;
export type DailyLogWeekConfiguredEvent = V1Envelope<"daily_log_week.configured">;
export type DailyLogCompletedEvent = V1Envelope<"daily_log.completed">;
export type LearningItemViewedEvent = V1Envelope<"learning_item.viewed">;
export type LearningItemCompletedEvent = V1Envelope<"learning_item.completed">;

// Rejection reasons. These are the `error` values Pal returns with a 422, so
// producers can branch on them without parsing prose. All of them are
// non-retryable: the same payload will always fail the same way.
export const V1_ERRORS = [
  "unsupported_schema_version",
  "missing_required_fields",
  "unknown_event_type",
  "invalid_idempotency_key",
  "invalid_learner_id",
  "invalid_occurred_at",
  "invalid_envelope",
  "invalid_metadata",
] as const;

export type V1Error = (typeof V1_ERRORS)[number];

export type V1ValidationResult =
  | { ok: true; event: V1Envelope }
  | { ok: false; error: V1Error; detail: string };
