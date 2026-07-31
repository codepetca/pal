import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMutations, LEVEL_UP, STREAK_MILESTONE, XP_CHANGED } from "./apply";
import type { IncomingEvent, LearnerState } from "./types";

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

function log(day: string): IncomingEvent {
  return {
    event_type: "daily_log.completed",
    occurred_at: `${day}T12:00:00.000Z`,
    metadata: {},
  };
}

function withEconomy(overrides: Partial<LearnerState["economy"]>): LearnerState {
  return { ...baseState, economy: { ...baseState.economy, ...overrides } };
}

function withPet(overrides: Partial<LearnerState["pet"]>): LearnerState {
  return { ...baseState, pet: { ...baseState.pet, ...overrides } };
}

describe("applyMutations", () => {
  it("does not mutate the state it was given", () => {
    const before = structuredClone(baseState);
    applyMutations(baseState, [{ type: "XP_GRANT", amount: 50 }], log("2026-03-01"));
    assert.deepEqual(baseState, before);
  });

  // --- XP ---

  it("adds XP and derives XP_CHANGED", () => {
    const { state, derived } = applyMutations(
      baseState,
      [{ type: "XP_GRANT", amount: 150 }],
      log("2026-03-01")
    );
    assert.equal(state.economy.xp, 150);
    assert.deepEqual(
      derived.map((e) => e.event_type),
      [XP_CHANGED]
    );
  });

  it("derives XP_CHANGED only once for several grants in the same batch", () => {
    const { state, derived } = applyMutations(
      baseState,
      [
        { type: "XP_GRANT", amount: 150 },
        { type: "XP_GRANT", amount: 50 },
      ],
      log("2026-03-01")
    );
    assert.equal(state.economy.xp, 200);
    assert.equal(derived.filter((e) => e.event_type === XP_CHANGED).length, 1);
  });

  it("spends XP on a negative grant without touching lifetime XP", () => {
    const { state } = applyMutations(
      withEconomy({ xp: 650, xp_lifetime: 650 }),
      [{ type: "XP_GRANT", amount: -500 }],
      log("2026-03-01")
    );
    assert.equal(state.economy.xp, 150);
    // Lifetime XP is what achievements will key on — spending must not erase it.
    assert.equal(state.economy.xp_lifetime, 650);
  });

  it("clamps XP at zero rather than going negative", () => {
    const { state } = applyMutations(
      withEconomy({ xp: 100 }),
      [{ type: "XP_GRANT", amount: -500 }],
      log("2026-03-01")
    );
    assert.equal(state.economy.xp, 0);
  });

  it("derives no XP_CHANGED when XP does not actually change", () => {
    const { derived } = applyMutations(
      baseState,
      [{ type: "XP_GRANT", amount: 0 }],
      log("2026-03-01")
    );
    assert.deepEqual(derived, []);
  });

  // --- Levels ---

  it("increments the level and derives LEVEL_UP", () => {
    const { state, derived } = applyMutations(
      baseState,
      [{ type: "LEVEL_GRANT", levels: 1 }],
      log("2026-03-01")
    );
    assert.equal(state.economy.level, 2);
    assert.deepEqual(
      derived.map((e) => e.event_type),
      [LEVEL_UP]
    );
  });

  // --- Streak continuity ---

  it("starts a streak at 1 on the first daily log", () => {
    const { state, derived } = applyMutations(
      baseState,
      [{ type: "STREAK", continue_streak: true }],
      log("2026-03-01")
    );
    assert.equal(state.economy.streak_current, 1);
    assert.equal(state.economy.streak_last_day, "2026-03-01");
    assert.deepEqual(
      derived.map((e) => e.event_type),
      [STREAK_MILESTONE]
    );
  });

  it("advances the streak on a consecutive day", () => {
    const { state } = applyMutations(
      withEconomy({ streak_current: 4, streak_last_day: "2026-03-04" }),
      [{ type: "STREAK", continue_streak: true }],
      log("2026-03-05")
    );
    assert.equal(state.economy.streak_current, 5);
  });

  it("ignores a second daily log on the same day", () => {
    // Without this, a learner could log twice and bank the day's bonus twice.
    const { state, derived } = applyMutations(
      withEconomy({ streak_current: 4, streak_last_day: "2026-03-05" }),
      [{ type: "STREAK", continue_streak: true }],
      log("2026-03-05")
    );
    assert.equal(state.economy.streak_current, 4);
    assert.deepEqual(derived, []);
  });

  it("resets the streak to 1 after a missed day", () => {
    // This is how a streak breaks: no calendar event required, the gap speaks for itself.
    const { state } = applyMutations(
      withEconomy({ streak_current: 9, streak_last_day: "2026-03-01" }),
      [{ type: "STREAK", continue_streak: true }],
      log("2026-03-04")
    );
    assert.equal(state.economy.streak_current, 1);
  });

  it("clears the streak when a rule explicitly breaks it", () => {
    const { state, derived } = applyMutations(
      withEconomy({ streak_current: 9, streak_last_day: "2026-03-01" }),
      [{ type: "STREAK", continue_streak: false }],
      log("2026-03-02")
    );
    assert.equal(state.economy.streak_current, 0);
    assert.equal(state.economy.streak_last_day, null);
    assert.deepEqual(derived, []);
  });

  it("advances the streak across a month boundary", () => {
    const { state } = applyMutations(
      withEconomy({ streak_current: 2, streak_last_day: "2026-02-28" }),
      [{ type: "STREAK", continue_streak: true }],
      log("2026-03-01")
    );
    assert.equal(state.economy.streak_current, 3);
  });

  // --- Pet and world ---

  it("expires the pet mood relative to when the event occurred", () => {
    const { state } = applyMutations(
      baseState,
      [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T12:30:00.000Z");
  });

  it("lets a stronger mood take over one that is still running", () => {
    const { state } = applyMutations(
      withPet({ mood: "happy", mood_expires_at: "2026-03-01T12:30:00.000Z" }),
      [{ type: "PET_MOOD", mood: "excited", duration_minutes: 60 }],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "excited");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T13:00:00.000Z");
  });

  it("keeps a stronger mood when a weaker one fires inside its window", () => {
    const { state } = applyMutations(
      withPet({ mood: "excited", mood_expires_at: "2026-03-01T13:00:00.000Z" }),
      [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "excited");
    // The window is not extended either — it still ends 60 minutes after the
    // level-up that set it, not 30 minutes after this event.
    assert.equal(state.pet.mood_expires_at, "2026-03-01T13:00:00.000Z");
  });

  it("lets a weaker mood take over once the stronger one has expired", () => {
    const { state } = applyMutations(
      withPet({ mood: "excited", mood_expires_at: "2026-03-01T11:00:00.000Z" }),
      [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T12:30:00.000Z");
  });

  it("lets a mood of equal strength refresh its own window", () => {
    const { state } = applyMutations(
      withPet({ mood: "happy", mood_expires_at: "2026-03-01T12:10:00.000Z" }),
      [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T12:30:00.000Z");
  });

  it("ends on the strongest mood when one cascade sets several", () => {
    // What an assignment that also levels the learner up emits: the assignment's
    // own `happy` first, then `excited` from the derived LEVEL_UP.
    const { state } = applyMutations(
      baseState,
      [
        { type: "PET_MOOD", mood: "happy", duration_minutes: 30 },
        { type: "PET_MOOD", mood: "excited", duration_minutes: 60 },
      ],
      log("2026-03-01")
    );
    assert.equal(state.pet.mood, "excited");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T13:00:00.000Z");
  });

  it("does not let a backdated stronger mood shorten a newer mood window", () => {
    const { state } = applyMutations(
      withPet({ mood: "happy", mood_expires_at: "2026-03-01T12:30:00.000Z" }),
      [{ type: "PET_MOOD", mood: "excited", duration_minutes: 60 }],
      log("2026-02-28")
    );
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T12:30:00.000Z");
  });

  it("does not let a backdated equal mood shorten a newer mood window", () => {
    const { state } = applyMutations(
      withPet({ mood: "happy", mood_expires_at: "2026-03-01T12:30:00.000Z" }),
      [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }],
      log("2026-02-28")
    );
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-03-01T12:30:00.000Z");
  });

  it("unlocks a world object only once, however often the rule re-fires", () => {
    const { state } = applyMutations(
      withEconomy({}),
      [
        { type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" },
        { type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" },
      ],
      log("2026-03-01")
    );
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("records when the learner was last active", () => {
    const { state } = applyMutations(baseState, [], log("2026-03-01"));
    assert.equal(state.economy.last_event_at, "2026-03-01T12:00:00.000Z");
  });

  it("does not move last_event_at backward on an out-of-order event", () => {
    const { state } = applyMutations(
      withEconomy({ last_event_at: "2026-03-05T12:00:00.000Z" }),
      [],
      log("2026-03-02")
    );
    assert.equal(state.economy.last_event_at, "2026-03-05T12:00:00.000Z");
  });

  it("orders last_event_at as timestamps, not strings", () => {
    // "+05:00" sorts lexicographically after any "…Z" string, but as an instant
    // this is 07:00Z — an hour *before* the recorded 08:00Z. It must not win.
    const { state } = applyMutations(
      withEconomy({ last_event_at: "2026-03-01T08:00:00.000Z" }),
      [],
      {
        event_type: "daily_log.completed",
        occurred_at: "2026-03-01T12:00:00.000+05:00",
        metadata: {},
      }
    );
    assert.equal(state.economy.last_event_at, "2026-03-01T08:00:00.000Z");
  });
});
