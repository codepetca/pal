import {
  COLLECTION_SYNC,
  DAILY_LOG_REWARD_SETTLED,
  LEVEL_UP,
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
      // The source event advances only the forward-only rhythm. Persistence emits
      // DAILY_LOG_REWARD_SETTLED exactly once when it inserts the durable settlement
      // marker, so a valid older day can still earn flat XP without moving the streak
      // backward and retries cannot farm the reward.
      id: "daily-log-streak",
      trigger: { event_type: "daily_log.completed" },
      conditions: [],
      effects: [{ type: "STREAK", continue_streak: true }],
    },
    {
      // The once-per-qualified-day base reward. This internal event is never accepted
      // at the public API; the transactional persistence orchestrator emits it only
      // after winning the exact-once settlement-marker insert.
      id: "daily-log-xp",
      trigger: { event_type: DAILY_LOG_REWARD_SETTLED },
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
