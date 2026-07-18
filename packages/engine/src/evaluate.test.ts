import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluate";
import { defaultRulePack } from "./default-rules";
import { LEVEL_UP, STREAK_MILESTONE, XP_CHANGED } from "./apply";
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
  it("grants XP when assignment is completed", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 150);
  });

  it("grants bonus XP when assignment is completed on time", () => {
    const mutations = evaluate(
      {
        event_type: "assignment.completed",
        occurred_at: AT,
        metadata: { on_time: true },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 200); // 150 base + 50 on-time bonus
  });

  it("does not grant on-time bonus when assignment is late", () => {
    const mutations = evaluate(
      {
        event_type: "assignment.completed",
        occurred_at: AT,
        metadata: { on_time: false },
      },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 150);
  });

  it("does not grant on-time bonus when the on_time flag is absent", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 150);
  });

  it("sets pet mood to happy after assignment", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: AT, metadata: {} },
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

  // --- Daily check-in ---
  //
  // The check-in event only advances the streak. Both the base XP and the streak
  // bonus are paid on the derived STREAK_MILESTONE, which fires once per day — so a
  // second same-day check-in advances nothing and earns nothing.

  it("only continues the streak on a daily check-in, granting no XP directly", () => {
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 0);
    assert.deepEqual(
      mutations.find((m) => m.type === "STREAK"),
      { type: "STREAK", continue_streak: true }
    );
  });

  it("does not pay any check-in XP on the check-in event itself", () => {
    // Both base and bonus belong to STREAK_MILESTONE, derived after the streak
    // advances. Paying here would read yesterday's streak and let repeated same-day
    // check-ins farm XP, since the streak's same-day guard wouldn't gate the XP.
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 9 }),
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 0);
  });

  // --- Check-in XP on the derived milestone (base + tiered bonus, streak includes today) ---

  it("pays only the base check-in XP on day 1", () => {
    const mutations = evaluate(
      { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 1 }),
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 10); // base 10, no streak bonus yet
  });

  for (const [streak, bonus] of [
    [2, 3],
    [3, 3],
    [4, 6],
    [5, 6],
    [6, 9],
    [7, 9],
    [8, 12],
    [9, 12],
    [10, 15],
  ] as const) {
    it(`pays 10 base + ${bonus} streak bonus on day ${streak}`, () => {
      const mutations = evaluate(
        { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
        withEconomy({ streak_current: streak }),
        defaultRulePack
      );
      assert.equal(totalXp(mutations), 10 + bonus);
    });
  }

  it("caps the streak bonus at +15 (25 total) beyond day 10", () => {
    const mutations = evaluate(
      { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 40 }),
      defaultRulePack
    );
    assert.equal(totalXp(mutations), 25); // base 10 + capped bonus 15
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

  it("unlocks a world asset at the streak 7 milestone", () => {
    const mutations = evaluate(
      { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 7 }),
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "WORLD_UNLOCK"),
      { type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }
    );
  });

  it("does NOT unlock the world asset below streak 7", () => {
    const mutations = evaluate(
      { event_type: STREAK_MILESTONE, occurred_at: AT, metadata: {} },
      withEconomy({ streak_current: 6 }),
      defaultRulePack
    );
    assert.equal(
      mutations.find((m) => m.type === "WORLD_UNLOCK"),
      undefined
    );
  });

  it("advances world stage on calendar.month_end", () => {
    const mutations = evaluate(
      { event_type: "calendar.month_end", occurred_at: AT, metadata: {} },
      baseState,
      defaultRulePack
    );
    assert.deepEqual(
      mutations.find((m) => m.type === "WORLD_STAGE"),
      { type: "WORLD_STAGE", stage: 1 }
    );
  });
});
