import type { RulePack } from "./types";

// The default rule pack — used by the dev sandbox and as the baseline for integrations.
// Operators can create custom rule packs that extend or replace these rules.
export const defaultRulePack: RulePack = {
  id: "default-v1",
  rules: [
    {
      id: "assignment-xp",
      trigger: { event_type: "assignment.completed" },
      conditions: [],
      effects: [
        { type: "XP_GRANT", amount: 50 },
        { type: "PET_MOOD", mood: "happy", duration_minutes: 30 },
      ],
    },
    {
      id: "assignment-on-time-bonus",
      trigger: { event_type: "assignment.completed" },
      conditions: [{ field: "metadata.on_time", op: "eq", value: true }],
      effects: [{ type: "XP_GRANT", amount: 25 }],
    },
    {
      id: "daily-checkin-xp",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [],
      effects: [{ type: "XP_GRANT", amount: 10 }],
    },
    {
      id: "streak-7-world-unlock",
      trigger: { event_type: "STREAK_MILESTONE" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 7 }],
      effects: [{ type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }],
    },
    {
      id: "world-month-1",
      trigger: { event_type: "calendar.month_end" },
      conditions: [],
      effects: [{ type: "WORLD_STAGE", stage: 1 }],
    },
  ],
};
