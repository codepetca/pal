import {
  COLLECTION_SYNC,
  LEVEL_UP,
  STREAK_MILESTONE,
  WEEKLY_RHYTHM_EARNED,
  XP_CHANGED,
} from "./apply";
import { PROGRESSION_POLICY } from "./progression-policy";
import type { RulePack } from "./types";

// The default rule pack — used by the dev sandbox and as the baseline for integrations.
// Operators can create custom rule packs that extend or replace these rules.
export const defaultRulePack: RulePack = {
  id: "default-v1",
  rules: [
    // ── Learning item completed ──────────────────────────────────────────
    {
      id: "learning-item-xp",
      trigger: { event_type: "learning_item.completed" },
      conditions: [],
      effects: [
        { type: "XP_GRANT", amount: PROGRESSION_POLICY.learningItemXp },
        { type: "PET_MOOD", mood: "happy", duration_minutes: 30 },
      ],
    },
    {
      id: "learning-item-on-time-bonus",
      trigger: { event_type: "learning_item.completed" },
      conditions: [{ field: "metadata.timing", op: "eq", value: "on_time" }],
      effects: [
        {
          type: "XP_GRANT",
          amount: PROGRESSION_POLICY.learningItemOnTimeBonusXp,
        },
      ],
    },

    // ── Daily log completed ─────────────────────────────────────────────
    {
      // The daily-log event only advances the streak; it grants no XP itself. The
      // XP is paid on the derived STREAK_MILESTONE below, which fires once per source
      // day — so a learner sending several daily-log events in one day earns the
      // day's XP exactly once. Paying XP here instead would let repeated same-day
      // events farm DAILY_LOG_XP without limit.
      id: "daily-log-streak",
      trigger: { event_type: "daily_log.completed" },
      conditions: [],
      effects: [{ type: "STREAK", continue_streak: true }],
    },
    {
      // The once-per-day base reward. STREAK_MILESTONE is derived only when the
      // streak actually advanced, so this cannot double-pay within a day.
      id: "daily-log-xp",
      trigger: { event_type: STREAK_MILESTONE },
      conditions: [],
      effects: [{ type: "XP_GRANT", amount: PROGRESSION_POLICY.dailyLogXp }],
    },

    // ── Weekly Rhythm earned ─────────────────────────────────────────────
    {
      id: "weekly-rhythm-xp",
      trigger: { event_type: WEEKLY_RHYTHM_EARNED },
      conditions: [],
      effects: [
        { type: "XP_GRANT", amount: PROGRESSION_POLICY.weeklyRhythmXp },
        { type: "PET_MOOD", mood: "excited", duration_minutes: 60 },
      ],
    },
    ...PROGRESSION_POLICY.collectionMilestones.map((milestone) => ({
      id: `weekly-rhythm-${milestone.weeklyRhythms}-collection-unlock`,
      trigger: { event_type: COLLECTION_SYNC },
      conditions: [
        {
          field: "metadata.weekly_rhythm_count",
          // COLLECTION_SYNC is emitted once for each genuinely missing
          // milestone. Exact matching keeps the mutation stream idempotent too,
          // rather than merely relying on world-state application to dedupe it.
          op: "eq" as const,
          value: milestone.weeklyRhythms,
        },
      ],
      effects: [
        { type: "WORLD_UNLOCK" as const, asset_ref_id: milestone.assetRefId },
      ],
    })),

    // ── Level up ─────────────────────────────────────────────────────────
    {
      // Fires on the derived XP_CHANGED, so it reads XP *after* the grant landed.
      // Banking enough XP for two levels at once levels twice: the deduction below
      // changes XP again, which derives another XP_CHANGED, up to the cascade depth
      // limit. Any XP past that stays in the balance and levels on the next event.
      id: "level-up",
      trigger: { event_type: XP_CHANGED },
      conditions: [
        {
          field: "economy.xp",
          op: "gte",
          value: PROGRESSION_POLICY.levelUpCostXp,
        },
      ],
      effects: [
        { type: "XP_GRANT", amount: -PROGRESSION_POLICY.levelUpCostXp },
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
  ],
};
