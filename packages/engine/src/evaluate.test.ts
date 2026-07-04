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
    assert.deepEqual(xpGrants[0], { type: "XP_GRANT", amount: 50 });
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
    assert.equal(total, 75); // 50 base + 25 on-time bonus
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
    assert.equal(total, 50);
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
});
