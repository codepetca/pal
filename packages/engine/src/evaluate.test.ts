import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluate";
import { defaultRulePack } from "./default-rules";
import type { LearnerState, RulePack } from "./types";

const baseState: LearnerState = {
  economy: { xp: 0, level: 1, streak_current: 0, last_event_at: null },
  pet: { mood: "neutral", mood_expires_at: null },
  world: { stage: 0, unlocked_object_ids: [] },
};

describe("evaluate", () => {
  it("grants XP when assignment is completed", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      defaultRulePack
    );
    const xpGrants = mutations.filter((m) => m.type === "XP_GRANT");
    assert.equal(xpGrants.length, 1);
    assert.deepEqual(xpGrants[0], { type: "XP_GRANT", amount: 150 });
  });

  it("grants bonus XP when assignment is completed on time", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: new Date().toISOString(), metadata: { on_time: true } },
      baseState,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 200); // 150 base + 50 on-time bonus
  });

  it("does not grant on-time bonus when assignment is late", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: new Date().toISOString(), metadata: { on_time: false } },
      baseState,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 150);
  });

  it("sets pet mood to happy after assignment", () => {
    const mutations = evaluate(
      { event_type: "assignment.completed", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      defaultRulePack
    );
    const moodMutation = mutations.find((m) => m.type === "PET_MOOD");
    assert.ok(moodMutation);
    assert.deepEqual(moodMutation, { type: "PET_MOOD", mood: "happy", duration_minutes: 30 });
  });

  it("returns no mutations for an unrecognised event type", () => {
    const mutations = evaluate(
      { event_type: "unknown.event", occurred_at: new Date().toISOString(), metadata: {} },
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
      { event_type: "resource.viewed", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      nudgePack
    );
    assert.deepEqual(mutations, [{ type: "NUDGE", copy_id: "welcome-back-v1" }]);
  });

  // --- Daily checkin (daily log) ---

  it("grants 10 XP for a daily checkin", () => {
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      defaultRulePack
    );
    const xpGrants = mutations.filter((m) => m.type === "XP_GRANT");
    const total = xpGrants.reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 10);
  });

  it("starts a streak on daily checkin", () => {
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      defaultRulePack
    );
    const streakMutation = mutations.find((m) => m.type === "STREAK");
    assert.ok(streakMutation);
    assert.deepEqual(streakMutation, { type: "STREAK", continue_streak: true });
  });

  // --- Streak bonuses ---

  it("grants no streak bonus at streak 1", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 1 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 10); // base only, no bonus yet
  });

  it("grants +3 streak bonus at streak 2", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 2 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 13); // 10 base + 3 streak
  });

  it("grants +6 streak bonus at streak 4", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 4 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 16); // 10 base + 3 + 3
  });

  it("grants +9 streak bonus at streak 6", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 6 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 19); // 10 base + 3 + 3 + 3
  });

  it("grants +12 streak bonus at streak 8", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 8 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 22); // 10 base + 3 + 3 + 3 + 3
  });

  it("grants max +15 streak bonus at streak 10", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 10 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 25); // 10 base + 3 × 5 = 15 bonus
  });

  it("streak bonus stays capped at +15 beyond streak 10", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 12 },
    };
    const mutations = evaluate(
      { event_type: "daily_checkin.created", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const total = mutations
      .filter((m) => m.type === "XP_GRANT")
      .reduce((sum, m) => sum + (m as { type: "XP_GRANT"; amount: number }).amount, 0);
    assert.equal(total, 25); // still capped at 10 base + 15 bonus
  });

  // --- Streak break ---

  it("breaks the streak on calendar.day_end when no checkin today", () => {
    const mutations = evaluate(
      { event_type: "calendar.day_end", occurred_at: new Date().toISOString(), metadata: { completed_today: false } },
      { ...baseState, economy: { ...baseState.economy, streak_current: 7 } },
      defaultRulePack
    );
    const streakMutation = mutations.find((m) => m.type === "STREAK");
    assert.ok(streakMutation);
    assert.deepEqual(streakMutation, { type: "STREAK", continue_streak: false });
  });

  // --- Level up ---

  it("triggers level up when XP reaches 500", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, xp: 500 },
    };
    const mutations = evaluate(
      { event_type: "economy.xp_increase", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const levelUp = mutations.find((m) => m.type === "LEVEL_UP");
    assert.ok(levelUp);
    const xpDeduction = mutations.find((m) => m.type === "XP_GRANT");
    assert.ok(xpDeduction);
    assert.deepEqual(xpDeduction, { type: "XP_GRANT", amount: -500 });
  });

  it("triggers level up when XP exceeds 500", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, xp: 650 },
    };
    const mutations = evaluate(
      { event_type: "economy.xp_increase", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    assert.ok(mutations.find((m) => m.type === "LEVEL_UP"));
  });

  it("does NOT trigger level up when XP is below 500", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, xp: 499 },
    };
    const mutations = evaluate(
      { event_type: "economy.xp_increase", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const levelUp = mutations.find((m) => m.type === "LEVEL_UP");
    assert.equal(levelUp, undefined);
  });

  // --- World progression ---

  it("unlocks a world asset at streak 7 milestone", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 7 },
    };
    const mutations = evaluate(
      { event_type: "STREAK_MILESTONE", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const unlock = mutations.find((m) => m.type === "WORLD_UNLOCK");
    assert.ok(unlock);
    assert.deepEqual(unlock, { type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" });
  });

  it("does NOT unlock world asset below streak 7", () => {
    const state: LearnerState = {
      ...baseState,
      economy: { ...baseState.economy, streak_current: 6 },
    };
    const mutations = evaluate(
      { event_type: "STREAK_MILESTONE", occurred_at: new Date().toISOString(), metadata: {} },
      state,
      defaultRulePack
    );
    const unlock = mutations.find((m) => m.type === "WORLD_UNLOCK");
    assert.equal(unlock, undefined);
  });

  it("advances world stage on calendar.month_end", () => {
    const mutations = evaluate(
      { event_type: "calendar.month_end", occurred_at: new Date().toISOString(), metadata: {} },
      baseState,
      defaultRulePack
    );
    const stageMutation = mutations.find((m) => m.type === "WORLD_STAGE");
    assert.ok(stageMutation);
    assert.deepEqual(stageMutation, { type: "WORLD_STAGE", stage: 1 });
  });
});
