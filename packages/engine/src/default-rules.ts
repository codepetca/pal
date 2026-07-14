import { LEVEL_UP, STREAK_MILESTONE, XP_CHANGED } from "./apply";
import type { Rule, RulePack } from "./types";

// Economy numbers. See docs/economy-design.md — change them here, not in the rules.
const ASSIGNMENT_XP = 150;
const ASSIGNMENT_ON_TIME_BONUS_XP = 50;
const DAILY_CHECKIN_XP = 10;
const STREAK_BONUS_XP = 3;
const STREAK_BONUS_EVERY_DAYS = 2;
const STREAK_BONUS_MAX_XP = 15;
const LEVEL_UP_COST_XP = 500;

// "+3 XP every 2 days, capped at +15" is a formula, but rule effects are literal
// mutations by design — the engine does no arithmetic. So the formula is expanded
// into one rule per tier (streak 2, 4, 6, 8, 10), each granting a flat +3. A
// learner on a 10-day streak matches all five and earns the full +15.
//
// The tiers fire on STREAK_MILESTONE, not on the check-in event itself: the
// milestone is derived *after* the streak advances, so `streak_current` is the
// learner's streak including today. Reading it on the check-in event would see
// yesterday's streak and pay every bonus a day late.
const streakBonusRules: Rule[] = Array.from(
  { length: STREAK_BONUS_MAX_XP / STREAK_BONUS_XP },
  (_, tier) => {
    const streakDays = (tier + 1) * STREAK_BONUS_EVERY_DAYS;
    return {
      id: `daily-checkin-${streakDays}-streak-bonus`,
      trigger: { event_type: STREAK_MILESTONE },
      conditions: [
        {
          field: "economy.streak_current",
          op: "gte" as const,
          value: streakDays,
        },
      ],
      effects: [{ type: "XP_GRANT" as const, amount: STREAK_BONUS_XP }],
    };
  }
);

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
        { type: "XP_GRANT", amount: ASSIGNMENT_XP },
        { type: "PET_MOOD", mood: "happy", duration_minutes: 30 },
      ],
    },
    {
      id: "assignment-on-time-bonus",
      trigger: { event_type: "assignment.completed" },
      conditions: [{ field: "metadata.on_time", op: "eq", value: true }],
      effects: [{ type: "XP_GRANT", amount: ASSIGNMENT_ON_TIME_BONUS_XP }],
    },
    {
      id: "daily-checkin-xp",
      trigger: { event_type: "daily_checkin.created" },
      conditions: [],
      effects: [
        { type: "XP_GRANT", amount: DAILY_CHECKIN_XP },
        { type: "STREAK", continue_streak: true },
      ],
    },
    ...streakBonusRules,
    {
      // Fires on the derived XP_CHANGED, so it reads XP *after* the grant landed.
      // Banking enough XP for two levels at once levels twice: the deduction below
      // changes XP again, which derives another XP_CHANGED, up to the cascade depth
      // limit. Any XP past that stays in the balance and levels on the next event.
      id: "level-up",
      trigger: { event_type: XP_CHANGED },
      conditions: [{ field: "economy.xp", op: "gte", value: LEVEL_UP_COST_XP }],
      effects: [
        { type: "XP_GRANT", amount: -LEVEL_UP_COST_XP },
        { type: "LEVEL_GRANT", levels: 1 },
      ],
    },
    {
      // docs/economy-design.md: "Each level-up should trigger visual or progression
      // changes in the virtual world or for their pet."
      id: "level-up-celebration",
      trigger: { event_type: LEVEL_UP },
      conditions: [],
      effects: [{ type: "PET_MOOD", mood: "excited", duration_minutes: 60 }],
    },
    {
      id: "streak-7-world-unlock",
      trigger: { event_type: STREAK_MILESTONE },
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
