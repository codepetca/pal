export type SandboxAction =
  | "session-started"
  | "classroom-joined"
  | "week-configured"
  | "short-week-configured"
  | "daily-log-completed"
  | "item-opened-early"
  | "on-time-finish"
  | "late-finish"
  | "duplicate-replayed"
  | "reset";

export type SandboxEventRequest = {
  schema_version: 1;
  idempotency_key: string;
  learner_id: string;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

// A completed fictional term keeps all 16 simulated weeks ingestable even
// though the production receiver correctly rejects future-dated facts.
export const FICTIONAL_SEMESTER_START_ISO = "2026-04-13T08:00:00.000Z";
const SEMESTER_START = new Date(FICTIONAL_SEMESTER_START_ISO);
export const FICTIONAL_SEMESTER_END_DAY = "2026-08-02";

export function semesterWeekForDate(date: Date): number {
  const diffDays = Math.floor(
    (date.getTime() - SEMESTER_START.getTime()) / (24 * 60 * 60 * 1000),
  );
  return Math.max(1, Math.min(16, Math.floor(diffDays / 7) + 1));
}

export function periodKeyForDate(date: Date): string {
  return `sandbox-week-${String(semesterWeekForDate(date)).padStart(2, "0")}`;
}

/** Maps sandbox controls to fully valid v1 events at the simulated instant. */
export function eventForAction(
  action: SandboxAction,
  simulatedDate: Date,
  learnerId: string,
  now = new Date(),
): SandboxEventRequest | null {
  const nonce = crypto.randomUUID();
  const simulatedOccurredAt = simulatedDate.toISOString();
  const reactionOccurredAt = now.toISOString();
  const periodKey = periodKeyForDate(simulatedDate);
  const base = {
    schema_version: 1 as const,
    idempotency_key: `sandbox-${nonce}`,
    learner_id: learnerId,
  };

  switch (action) {
    case "session-started":
      return {
        ...base,
        event_type: "platform.session.started",
        occurred_at: reactionOccurredAt,
        metadata: {},
      };
    case "classroom-joined":
      return {
        ...base,
        event_type: "classroom.joined",
        occurred_at: reactionOccurredAt,
        metadata: { classroom_token: "sandbox-classroom" },
      };
    case "week-configured":
    case "short-week-configured":
      return {
        ...base,
        event_type: "daily_log_week.configured",
        occurred_at: simulatedOccurredAt,
        metadata: {
          period_key: periodKey,
          config_version: action === "week-configured" ? 1 : 2,
          period_status: "open",
          eligible_days: action === "week-configured" ? 5 : 3,
          term_token: "sandbox-term-2026",
          term_start_day: FICTIONAL_SEMESTER_START_ISO.slice(0, 10),
          term_end_day: FICTIONAL_SEMESTER_END_DAY,
          week_index: semesterWeekForDate(simulatedDate),
        },
      };
    case "daily-log-completed":
      return {
        ...base,
        event_type: "daily_log.completed",
        occurred_at: simulatedOccurredAt,
        metadata: {
          period_key: periodKey,
          activity_day: simulatedOccurredAt.slice(0, 10),
        },
      };
    case "item-opened-early":
      return {
        ...base,
        event_type: "learning_item.viewed",
        occurred_at: reactionOccurredAt,
        metadata: {
          item_token: `sandbox-item-${nonce}`,
          kind: "assignment",
          period_key: periodKey,
          timing: "within_24h_of_release",
        },
      };
    case "on-time-finish":
    case "late-finish":
      return {
        ...base,
        event_type: "learning_item.completed",
        occurred_at: reactionOccurredAt,
        metadata: {
          item_token: `sandbox-item-${nonce}`,
          kind: "assignment",
          period_key: periodKey,
          timing: action === "on-time-finish" ? "on_time" : "late",
        },
      };
    default:
      return null;
  }
}

/**
 * Actions that depend on weekly opportunity context establish the fictional
 * academic period first. Item reactions use wall-clock time, so anchoring the
 * period also prevents them from reordering the 16-week roadmap.
 */
export function eventsForAction(
  action: SandboxAction,
  simulatedDate: Date,
  learnerId: string,
  now = new Date(),
): SandboxEventRequest[] {
  const event = eventForAction(action, simulatedDate, learnerId, now);
  if (!event) return [];

  if (
    action !== "daily-log-completed" &&
    action !== "item-opened-early" &&
    action !== "on-time-finish" &&
    action !== "late-finish"
  ) {
    return [event];
  }

  const periodConfiguration = eventForAction(
    "week-configured",
    simulatedDate,
    learnerId,
    now,
  );
  return periodConfiguration ? [periodConfiguration, event] : [event];
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isTodayOrEarlier(date: Date, today = new Date()): boolean {
  return date.toISOString().slice(0, 10) <= today.toISOString().slice(0, 10);
}
