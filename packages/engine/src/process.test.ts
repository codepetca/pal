import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processEvent } from "./process";
import { defaultRulePack } from "./default-rules";
import type { IncomingEvent, LearnerState, RulePack } from "./types";

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

function checkin(day: string): IncomingEvent {
  return {
    event_type: "daily_checkin.created",
    occurred_at: `${day}T12:00:00.000Z`,
    metadata: {},
  };
}

function assignment(day: string, onTime = false): IncomingEvent {
  return {
    event_type: "assignment.completed",
    occurred_at: `${day}T12:00:00.000Z`,
    metadata: { on_time: onTime },
  };
}

function withEconomy(overrides: Partial<LearnerState["economy"]>): LearnerState {
  return { ...baseState, economy: { ...baseState.economy, ...overrides } };
}

// These are the behaviours a learner actually experiences. They run the whole
// pipeline — evaluate, apply, re-evaluate the derived events — so a rule that
// triggers on an event nothing emits shows up here as "nothing happened".
describe("processEvent", () => {
  it("banks XP for an on-time assignment without levelling", () => {
    const { state } = processEvent(assignment("2026-03-01", true), baseState, defaultRulePack);
    assert.equal(state.economy.xp, 200);
    assert.equal(state.economy.xp_lifetime, 200);
    assert.equal(state.economy.level, 1);
    assert.equal(state.pet.mood, "happy");
  });

  it("pays the streak bonus on the right day, every day, for two weeks", () => {
    // The table the design doc promises: +3 every 2 days, first bonus on day 2,
    // capped at +15 from day 10. Reading the streak on the check-in event instead
    // of the derived milestone pays every one of these a day late.
    const expected = [
      { day: "2026-03-01", streak: 1, earned: 10 },
      { day: "2026-03-02", streak: 2, earned: 13 },
      { day: "2026-03-03", streak: 3, earned: 13 },
      { day: "2026-03-04", streak: 4, earned: 16 },
      { day: "2026-03-05", streak: 5, earned: 16 },
      { day: "2026-03-06", streak: 6, earned: 19 },
      { day: "2026-03-07", streak: 7, earned: 19 },
      { day: "2026-03-08", streak: 8, earned: 22 },
      { day: "2026-03-09", streak: 9, earned: 22 },
      { day: "2026-03-10", streak: 10, earned: 25 },
      { day: "2026-03-11", streak: 11, earned: 25 },
      { day: "2026-03-12", streak: 12, earned: 25 },
    ];

    let state = baseState;
    for (const { day, streak, earned } of expected) {
      const before = state.economy.xp;
      state = processEvent(checkin(day), state, defaultRulePack).state;
      assert.equal(state.economy.streak_current, streak, `streak on ${day}`);
      assert.equal(state.economy.xp - before, earned, `XP earned on ${day}`);
    }
  });

  it("unlocks the bird when the streak reaches 7", () => {
    let state = withEconomy({
      streak_current: 6,
      streak_last_day: "2026-03-06",
    });
    assert.deepEqual(state.world.unlocked_object_ids, []);

    state = processEvent(checkin("2026-03-07"), state, defaultRulePack).state;
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("gives nothing extra for a second check-in on the same day", () => {
    let state = processEvent(checkin("2026-03-01"), baseState, defaultRulePack).state;
    const afterFirst = structuredClone(state);

    state = processEvent(checkin("2026-03-01"), state, defaultRulePack).state;
    assert.equal(state.economy.streak_current, afterFirst.economy.streak_current);
    // The base check-in XP is still granted; only the streak (and its bonus) holds.
    assert.equal(state.economy.xp, afterFirst.economy.xp + 10);
  });

  it("resets the streak to 1 when a day is missed", () => {
    const state = processEvent(
      checkin("2026-03-10"),
      withEconomy({ streak_current: 9, streak_last_day: "2026-03-08" }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.streak_current, 1);
  });

  // --- Levelling ---

  it("levels up when banked XP crosses the threshold", () => {
    const state = processEvent(
      assignment("2026-03-01", true),
      withEconomy({ xp: 400, xp_lifetime: 400 }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.level, 2);
    assert.equal(state.economy.xp, 100); // 400 + 200 − 500 spent
    assert.equal(state.economy.xp_lifetime, 600); // untouched by the spend
    assert.equal(state.pet.mood, "excited"); // the level-up celebration
  });

  it("levels up twice when one event banks enough for two levels", () => {
    const { state, truncated } = processEvent(
      assignment("2026-03-01", true),
      withEconomy({ xp: 900, xp_lifetime: 900 }),
      defaultRulePack
    );
    assert.equal(state.economy.level, 3);
    assert.equal(state.economy.xp, 100); // 900 + 200 − 1000 spent
    assert.deepEqual(truncated, []);
  });

  it("carries surplus XP forward rather than losing it at the cascade limit", () => {
    // 2200 XP is four levels' worth, one more than the cascade depth allows. The
    // learner takes three levels now and the surplus stays banked — nothing is lost.
    const first = processEvent(
      assignment("2026-03-01", true),
      withEconomy({ xp: 2000, xp_lifetime: 2000 }),
      defaultRulePack
    );
    assert.equal(first.state.economy.level, 4);
    assert.equal(first.state.economy.xp, 700); // 2200 − 1500 spent on three levels
    assert.ok(first.truncated.includes("XP_CHANGED"));

    // ...and the very next event spends it.
    const second = processEvent(checkin("2026-03-02"), first.state, defaultRulePack);
    assert.equal(second.state.economy.level, 5);
    assert.equal(second.state.economy.xp, 210); // 700 + 10 check-in − 500 spent
  });

  it("does not level up one XP short of the threshold", () => {
    const state = processEvent(
      checkin("2026-03-01"),
      withEconomy({ xp: 489, xp_lifetime: 489 }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.xp, 499);
    assert.equal(state.economy.level, 1);
  });

  // --- Cascade safety ---

  it("stops and reports a rule pack that cascades forever", () => {
    // XP_CHANGED granting XP derives another XP_CHANGED, for ever.
    const runawayPack: RulePack = {
      id: "runaway",
      rules: [
        {
          id: "xp-feedback-loop",
          trigger: { event_type: "XP_CHANGED" },
          conditions: [],
          effects: [{ type: "XP_GRANT", amount: 1 }],
        },
        {
          id: "seed",
          trigger: { event_type: "daily_checkin.created" },
          conditions: [],
          effects: [{ type: "XP_GRANT", amount: 1 }],
        },
      ],
    };

    const { state, truncated } = processEvent(checkin("2026-03-01"), baseState, runawayPack);
    assert.deepEqual(truncated, ["XP_CHANGED"]);
    assert.equal(state.economy.xp, 4); // one seed + three cascade rounds, then stopped
  });

  it("records a trace of every evaluation in the cascade", () => {
    const { trace } = processEvent(
      assignment("2026-03-01", true),
      withEconomy({ xp: 400 }),
      defaultRulePack
    );
    assert.deepEqual(
      trace.map((entry) => [entry.depth, entry.event_type]),
      [
        [0, "assignment.completed"],
        [1, "XP_CHANGED"],
        [2, "XP_CHANGED"],
        [2, "LEVEL_UP"],
      ]
    );
  });

  it("leaves state untouched for an event no rule cares about", () => {
    const { state, mutations } = processEvent(
      {
        event_type: "resource.viewed",
        occurred_at: "2026-03-01T12:00:00.000Z",
        metadata: {},
      },
      baseState,
      defaultRulePack
    );
    assert.deepEqual(mutations, []);
    assert.equal(state.economy.xp, 0);
  });
});
