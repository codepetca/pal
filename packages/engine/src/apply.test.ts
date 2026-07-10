import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMutations } from "./apply";
import type { LearnerState, Mutation } from "./types";

const baseState: LearnerState = {
  economy: { xp: 0, level: 1, streak_current: 0, last_event_at: null },
  pet: { mood: "neutral", mood_expires_at: null },
  world: { stage: 0, unlocked_object_ids: [] },
};

const OCCURRED_AT = "2026-07-10T12:00:00.000Z";

describe("applyMutations", () => {
  it("adds XP_GRANT amounts to economy.xp", () => {
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 50 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.xp, 50);
  });

  it("increments streak_current by exactly 1 per call, even with multiple XP_GRANT mutations", () => {
    const mutations: Mutation[] = [
      { type: "XP_GRANT", amount: 50 },
      { type: "XP_GRANT", amount: 25 },
    ];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.xp, 75);
    assert.equal(state.economy.streak_current, 1);
  });

  it("does not touch streak_current when no XP_GRANT is present", () => {
    const mutations: Mutation[] = [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.streak_current, 0);
  });

  it("sets pet mood and computes mood_expires_at from occurred_at + duration_minutes", () => {
    const mutations: Mutation[] = [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-07-10T12:30:00.000Z");
  });

  it("adds a world unlock id", () => {
    const mutations: Mutation[] = [{ type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("does not duplicate a world unlock id that is already present", () => {
    const stateWithUnlock: LearnerState = {
      ...baseState,
      world: { stage: 0, unlocked_object_ids: ["world-bird-v1"] },
    };
    const mutations: Mutation[] = [{ type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }];
    const { state } = applyMutations(stateWithUnlock, mutations, OCCURRED_AT);
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("sets world stage", () => {
    const mutations: Mutation[] = [{ type: "WORLD_STAGE", stage: 2 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.world.stage, 2);
  });

  it("derives a STREAK_MILESTONE event when streak crosses from below 7 to 7 or above", () => {
    const stateAtSix: LearnerState = {
      ...baseState,
      economy: { xp: 0, level: 1, streak_current: 6, last_event_at: null },
    };
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { state, derivedEvents } = applyMutations(stateAtSix, mutations, OCCURRED_AT);
    assert.equal(state.economy.streak_current, 7);
    assert.deepEqual(derivedEvents, [
      { event_type: "STREAK_MILESTONE", occurred_at: OCCURRED_AT, metadata: {} },
    ]);
  });

  it("does not derive a STREAK_MILESTONE event when streak stays below 7", () => {
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { derivedEvents } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.deepEqual(derivedEvents, []);
  });

  it("does not re-derive a STREAK_MILESTONE event when streak is already at or above 7", () => {
    const stateAtSeven: LearnerState = {
      ...baseState,
      economy: { xp: 0, level: 1, streak_current: 7, last_event_at: null },
    };
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { derivedEvents } = applyMutations(stateAtSeven, mutations, OCCURRED_AT);
    assert.deepEqual(derivedEvents, []);
  });
});
