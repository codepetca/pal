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
        { type: "XP_GRANT", amount: 150 },
        { type: "PET_MOOD", mood: "happy", duration_minutes: 30 },
      ],
    },
    {
      id: "assignment-on-time-bonus",
      trigger: { event_type: "assignment.completed" },
      conditions: [{ field: "metadata.on_time", op: "eq", value: true }],
      effects: [{ type: "XP_GRANT", amount: 50 }],
    },
    {
      id: "daily-checkin-xp",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [],
      effects: [
        { type: "XP_GRANT", amount: 10 }, 
        { type: "STREAK", continue_streak: true }
      ],
    },
    {
      id: "daily-checkin-2-streak-bonus",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 2 }],
      effects: [{ type: "XP_GRANT", amount: 3 }, ],
    },
        {
      id: "daily-checkin-4-streak-bonus",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 4 }],
      effects: [{ type: "XP_GRANT", amount: 3 }, ],
    },
    {
      id: "daily-checkin-6-streak-bonus",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 6 }],
      effects: [{ type: "XP_GRANT", amount: 3 }, ],
    },
        {
      id: "daily-checkin-8-streak-bonus",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 8 }],
      effects: [{ type: "XP_GRANT", amount: 3 }, ],
    },
        {
      id: "daily-checkin-10-streak-bonus",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [{ field: "economy.streak_current", op: "gte", value: 10 }],
      effects: [{ type: "XP_GRANT", amount: 3 }, ],
    },
    {
      id: "daily-streak-break",
      trigger: { event_type: "economy.xp_increase" },
      conditions: [
        { field: "economy.completed_today", op: "eq", value: false }
      ],
      effects: [
        { type: "STREAK", continue_streak: false }
      ],
    },
    {
      id: "level-up",
      trigger: { event_type: "calendar.day_end" },
      conditions: [
        { field: "economy.xp", op: "gte", value: 500 }
      ],
      effects: [
        { type: "XP_GRANT", amount: -500 },
        { type: "LEVEL_UP" }
      ],
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
