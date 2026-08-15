import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluate";
import { defaultRulePack } from "./default-rules";
import {
  COLLECTION_SYNC,
  DAILY_LOG_REWARD_SETTLED,
  LEVEL_UP,
  STREAK_MILESTONE,
  WEEKLY_RHYTHM_EARNED,
  XP_CHANGED,
} from "./apply";
import type { LearnerState, Mutation, RulePack } from "./types";

const baseState: LearnerState = {
  economy: {
    xp: 0,
    xp_lifetime: 0,
    level: 1,
    streak_current: 0,
    streak_last_day: null,
    last_event_at: null,
  },
  pet: { mood: "neutral", mood_expires_at: null },
  world: { stage: 0, unlocked_object_ids: [] },
};

const AT = "2026-03-01T12:00:00.000Z";

function withEconomy(overrides: Partial<LearnerState["economy"]>): LearnerState {
  return { ...baseState, economy: { ...baseState.economy, ...overrides } };
}

function totalXp(mutations: Mutation[]): number {
  return mutations
    .filter((m): m is Extract<Mutation, { type: "XP_GRANT" }> => m.type === "XP_GRANT")
    .reduce((sum, m) => sum + m.amount, 0);
}

// These tests cover the engine in isolation: one event, one state, no cascade.
// The behaviours a learner actually experiences (streaks over days, levelling)
// span the cascade and live in process.test.ts.
describe("evaluate", () => {
  it("grants XP when learning item is completed", () => {
    const mutations = evaluate(
      { event_type: "learning_item.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 75);
  });

  it("grants bonus XP when learning item is completed on time", () => {
    const mutations = evaluate(
      {
        event_type: "learning_item.completed",
        occurred_at: AT,
        metadata: { timing: "on_time" },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 100); // 75 base + 25 on-time bonus
  });

  it("does not grant on-time bonus when learning item is late", () => {
    const mutations = evaluate(
      {
        event_type: "learning_item.completed",
        occurred_at: AT,
        metadata: { timing: "late" },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 75);
  });

  it("does not grant on-time bonus when the timing field is absent", () => {
    const mutations = evaluate(
      { event_type: "learning_item.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 75);
  });

  it("sets pet mood to happy after learning item completion", () => {
    const mutations = evaluate(
      { event_type: "learning_item.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "PET_MOOD"),
      { type: "PET_MOOD", mood: "happy", duration_minutes: 30 }
    );
  });

  it("returns no mutations for an unrecognised event type", () => {
    const mutations = evaluate(
      { event_type: "unknown.event", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(mutations.length, 0);
  });

  it("produces a NUDGE mutation when a rule's effects include one", () => {
    const nudgePack: RulePack = {
      id: "nudge-test",
      rules: [
        {
          id: "inactivity-nudge",
          trigger: { event_type: "resource.viewed" },
          conditions: [],
          effects: [{ type: "NUDGE", copy_id: "welcome-back-v1" }],
        },
      ],
    };
    const mutations = evaluate(
      { event_type: "resource.viewed", occurred_at: AT, metadata: {} },
      baseState,
      nudgePack
    );
    assert.deepEqual(mutations, [{ type: "NUDGE", copy_id: "welcome-back-v1" }]);
  });

  // --- Daily log completed ---
  //
  // The daily-log event only advances the streak. The exact-once persistence
  // settlement emits a separate internal event for flat daily XP.

  it("only continues the streak on a daily log, granting no XP directly", () => {
    const mutations = evaluate(
      { event_type: "daily_log.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 0);
    assert.deepEqual(
      mutations.find((m) => m.type === "STREAK"),
      { type: "STREAK", continue_streak: true }
    );
  });

  it("does not pay any XP on the daily-log event itself", () => {
    // Paying here would let repeated source deliveries farm XP before persistence
    // can enforce semantic identity and durable settlement.
    const mutations = evaluate(
      { event_type: "daily_log.completed", occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 9 }),
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 0);
  });

  // --- Daily-log XP on durable reward settlement ---

  it("does not pay XP merely because the streak advanced", () => {
    const mutations = evaluate(
      { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 1 }),
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 0);
  });

  for (const streak of [2, 4, 7, 10, 40]) {
    it(`keeps a settled daily reward flat at 10 XP on rhythm day ${streak}`, () => {
      const mutations = evaluate(
        { event_type: DAILY_LOG_REWARD_SETTLED, occurred_at: AT, metadata: {} },
        withEconomy({ streak_current: streak }),
        defaultRulePack
      );
      assert.equal(totalXp(mutations), 10);
    });
  }

  it("rewards an earned Weekly Rhythm with 75 XP", () => {
    const mutations = evaluate(
      {
        event_type: WEEKLY_RHYTHM_EARNED,
        occurred_at: AT,
        metadata: { weekly_rhythm_count: 1 },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 75);
  });

  // --- Level up (on the derived XP_CHANGED, so XP is post-grant) ---

  it("levels up when XP reaches the 500 threshold", () => {
    const mutations = evaluate(
      { event_type: XP_CHANGED, occurred_at: AT, metadata: {} },
      withEconomy({ xp: 500 }),
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "LEVEL_GRANT"),
      { type: "LEVEL_GRANT", levels: 1 }
    );
    assert.equal(totalXp(mutations), -500); // the level-up spends the XP
  });

  it("does NOT level up one XP short of the threshold", () => {
    const mutations = evaluate(
      { event_type: XP_CHANGED, occurred_at: AT, metadata: {} },
      withEconomy({ xp: 499 }),
      defaultRulePack
    );
    assert.equal(
      mutations.find((m) => m.type === "LEVEL_GRANT"),
      undefined
    );
  });

  it("celebrates a level-up with an excited pet", () => {
    const mutations = evaluate(
      { event_type: LEVEL_UP, occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "PET_MOOD"),
      { type: "PET_MOOD", mood: "excited", duration_minutes: 60 }
    );
  });

  // --- World progression ---

  it("unlocks the first collection item on the first Weekly Rhythm", () => {
    const mutations = evaluate(
      {
        event_type: COLLECTION_SYNC,
        occurred_at: AT,
        metadata: { weekly_rhythm_count: 1 },
      },
      baseState,
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "WORLD_UNLOCK"),
      { type: "WORLD_UNLOCK", asset_ref_id: "world-study-bird-v1" }
    );
  });

  it("does not unlock the fourth-rhythm item before its milestone", () => {
    const mutations = evaluate(
      {
        event_type: COLLECTION_SYNC,
        occurred_at: AT,
        metadata: { weekly_rhythm_count: 3 },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(
      mutations.find(
        (m) =>
          m.type === "WORLD_UNLOCK" &&
          m.asset_ref_id === "world-study-lamp-v1",
      ),
      undefined
    );
  });

  it("emits only the exact collection milestone being reconciled", () => {
    const mutations = evaluate(
      {
        event_type: COLLECTION_SYNC,
        occurred_at: AT,
        metadata: { weekly_rhythm_count: 4 },
      },
      baseState,
      defaultRulePack,
    );
    assert.deepEqual(
      mutations.filter((mutation) => mutation.type === "WORLD_UNLOCK"),
      [{ type: "WORLD_UNLOCK", asset_ref_id: "world-study-lamp-v1" }],
    );
  });
});
