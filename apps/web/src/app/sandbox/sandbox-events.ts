import type { PalFixtureAction } from "@codepet/pal-widget";

export type SandboxEventRequest = {
  schema_version: 1;
  idempotency_key: string;
  learner_id: string;
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

/** Maps fixture controls to a fully valid v1 event at the simulated instant. */
export function eventForAction(
  action: PalFixtureAction,
  simulatedDate: Date,
  learnerId: string,
  now = new Date(),
): SandboxEventRequest | null {
  // Daily logs use the selected semester day so streak scenarios are coherent.
  // Other actions use the current instant: pet moods deliberately expire from
  // occurred_at, so backdating a completion would hide its engine reaction.
  const occurredAt = (
    action === "daily-log-completed" ? simulatedDate : now
  ).toISOString();
  const base = {
    schema_version: 1 as const,
    idempotency_key: `sandbox-${crypto.randomUUID()}`,
    learner_id: learnerId,
    occurred_at: occurredAt,
  };

  switch (action) {
    case "session-started":
      return { ...base, event_type: "platform.session.started", metadata: {} };
    case "daily-log-completed":
      return {
        ...base,
        event_type: "daily_log.completed",
        metadata: {
          period_key: "sandbox-week",
          activity_day: simulatedDate.toISOString().slice(0, 10),
        },
      };
    case "on-time-finish":
    case "late-finish":
      return {
        ...base,
        event_type: "learning_item.completed",
        metadata: {
          item_token: "sandbox-item",
          kind: "assignment",
          period_key: "sandbox-week",
          timing: action === "on-time-finish" ? "on_time" : "late",
        },
      };
    default:
      return null;
  }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isTodayOrEarlier(date: Date, today = new Date()): boolean {
  return date.toISOString().slice(0, 10) <= today.toISOString().slice(0, 10);
}
