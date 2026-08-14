import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processEvent } from "./process";
import { defaultRulePack } from "./default-rules";
import { COLLECTION_SYNC } from "./apply";
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

function log(day: string): IncomingEvent {
  return {
    event_type: "daily_log.completed",
    occurred_at: `${day}T12:00:00.000Z`,
    metadata: { activity_day: day },
  };
}

function completedItem(day: string, timing?: string): IncomingEvent {
  return {
    event_type: "learning_item.completed",
    occurred_at: `${day}T12:00:00.000Z`,
    metadata: timing ? { timing } : {},
  };
}

function withEconomy(overrides: Partial<LearnerState["economy"]>): LearnerState {
  return { ...baseState, economy: { ...baseState.economy, ...overrides } };
}

// These are the behaviours a learner actually experiences. They run the whole
// pipeline — evaluate, apply, re-evaluate the derived events — so a rule that
// triggers on an event nothing emits shows up here as "nothing happened".
describe("processEvent", () => {
it("banks XP for an on-time learning item without levelling", () => {
    const { state } = processEvent(completedItem("2026-03-01", "on_time"), baseState, defaultRulePack);
    assert.equal(state.economy.xp, 100);
    assert.equal(state.economy.xp_lifetime, 100);
    assert.equal(state.economy.level, 1);
    assert.equal(state.pet.mood, "happy");
  });

  it("pays flat daily XP and carries the school-day rhythm across weekends", () => {
    const expected = [
      { day: "2026-03-02", streak: 1 },
      { day: "2026-03-03", streak: 2 },
      { day: "2026-03-04", streak: 3 },
      { day: "2026-03-05", streak: 4 },
      { day: "2026-03-06", streak: 5 },
      { day: "2026-03-09", streak: 6 },
      { day: "2026-03-10", streak: 7 },
    ];

    let state = baseState;
    for (const { day, streak } of expected) {
      const before = state.economy.xp;
      state = processEvent(log(day), state, defaultRulePack).state;
      assert.equal(state.economy.streak_current, streak, `streak on ${day}`);
      assert.equal(state.economy.xp - before, 10, `XP earned on ${day}`);
    }
  });

  it("unlocks the bird when the first Weekly Rhythm is earned", () => {
    const state = processEvent(
      {
        event_type: COLLECTION_SYNC,
        occurred_at: "2026-03-06T12:00:00.000Z",
        metadata: { weekly_rhythm_count: 1 },
      },
      baseState,
      defaultRulePack,
    ).state;
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

it("gives nothing at all for a second daily log on the same day", () => {
    let state = processEvent(log("2026-03-01"), baseState, defaultRulePack).state;
    const afterFirst = structuredClone(state);

    state = processEvent(log("2026-03-01"), state, defaultRulePack).state;
    // Neither the streak nor any XP moves: the day's reward is paid exactly once,
    // because both base and bonus hang off the streak advance, not the daily-log event.
    assert.deepEqual(state.economy, afterFirst.economy);
  });

  it("does not let repeated same-day daily logs farm XP", () => {
    // Regression: base daily-log XP used to fire on every check-in event, so N
    // same-day logs paid 10*N. It now fires on the once-per-day streak advance.
    let state = baseState;
    for (let i = 0; i < 50; i++) {
      state = processEvent(log("2026-03-01"), state, defaultRulePack).state;
    }
    assert.equal(state.economy.xp, 10); // one day's base reward, not 500
    assert.equal(state.economy.streak_current, 1);
  });

  it("never self-heals a future streak_last_day — keeping future days out is ingest's job", () => {
    // The forward-only guard cannot tell "this event is backdated" from "the stored
    // day is poisoned" — the engine is pure and has no clock. So if a future-dated
    // check-in ever got in, every real check-in before that day would be swallowed:
    // no streak, no milestone, no XP. This test pins that contract so the coupling
    // is visible: the ingest route MUST reject future occurred_at (see the
    // future_occurred_at 422 in apps/web/src/app/api/v1/events/route.ts).
    const poisoned = withEconomy({ streak_current: 1, streak_last_day: "2099-01-01" });
    const { state, mutations } = processEvent(log("2026-07-18"), poisoned, defaultRulePack);
    assert.equal(state.economy.streak_current, 1);
    assert.equal(state.economy.streak_last_day, "2099-01-01");
    assert.equal(state.economy.xp, 0); // no STREAK_MILESTONE → no check-in XP
    assert.deepEqual(
      mutations.filter((m) => m.type === "XP_GRANT"),
      []
    );
  });

  it("does not advance the streak on a backdated, out-of-order check-in", () => {
    // A check-in for an earlier day than the streak's last day (a delayed delivery
    // or a spoofed occurred_at) must not reset a legitimate streak or move it back.
    let state = processEvent(
      log("2026-03-05"),
      withEconomy({ streak_current: 4, streak_last_day: "2026-03-04" }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.streak_current, 5);
    assert.equal(state.economy.streak_last_day, "2026-03-05");

    state = processEvent(log("2026-03-02"), state, defaultRulePack).state;
    assert.equal(state.economy.streak_current, 5); // unchanged, not reset to 1
    assert.equal(state.economy.streak_last_day, "2026-03-05"); // not moved backward
  });

  it("resets the streak to 1 when a day is missed", () => {
    const state = processEvent(
      log("2026-03-10"),
      withEconomy({ streak_current: 9, streak_last_day: "2026-03-08" }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.streak_current, 1);
  });

  // --- Levelling ---

  it("levels up when banked XP crosses the threshold", () => {
    const state = processEvent(
      completedItem("2026-03-01", "on_time"),
      withEconomy({ xp: 400, xp_lifetime: 400 }),
      defaultRulePack
    ).state;
    assert.equal(state.economy.level, 2);
    assert.equal(state.economy.xp, 0); // 400 + 100 − 500 spent
    assert.equal(state.economy.xp_lifetime, 500); // untouched by the spend
    assert.equal(state.pet.mood, "excited"); // the level-up celebration
  });

  it("levels up twice when one event banks enough for two levels", () => {
    const { state, truncated } = processEvent(
      completedItem("2026-03-01", "on_time"),
      withEconomy({ xp: 900, xp_lifetime: 900 }),
      defaultRulePack
    );
    assert.equal(state.economy.level, 3);
    assert.equal(state.economy.xp, 0); // 900 + 100 − 1000 spent
    assert.deepEqual(truncated, []);
  });

  it("carries surplus XP forward rather than losing it at the cascade limit", () => {
    // 2100 XP is four levels' worth, one more than the cascade depth allows. The
    // learner takes three levels now and the surplus stays banked — nothing is lost.
    const first = processEvent(
      completedItem("2026-03-01", "on_time"),
      withEconomy({ xp: 2000, xp_lifetime: 2000 }),
      defaultRulePack
    );
    assert.equal(first.state.economy.level, 4);
    assert.equal(first.state.economy.xp, 600); // 2100 − 1500 spent on three levels
    assert.ok(first.truncated.includes("XP_CHANGED"));

    // ...and the very next event spends it.
    const second = processEvent(log("2026-03-02"), first.state, defaultRulePack);
    assert.equal(second.state.economy.level, 5);
    assert.equal(second.state.economy.xp, 110); // 600 + 10 daily-log − 500 spent
  });

  it("does not level up one XP short of the threshold", () => {
    const state = processEvent(
      log("2026-03-01"),
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
          trigger: { event_type: "daily_log.completed" },
          conditions: [],
          effects: [{ type: "XP_GRANT", amount: 1 }],
        },
      ],
    };

    const { state, truncated } = processEvent(log("2026-03-01"), baseState, runawayPack);
    assert.deepEqual(truncated, ["XP_CHANGED"]);
    assert.equal(state.economy.xp, 4); // one seed + three cascade rounds, then stopped
  });

  it("records a trace of every evaluation in the cascade", () => {
    const { trace } = processEvent(
      completedItem("2026-03-01", "on_time"),
      withEconomy({ xp: 400 }),
      defaultRulePack
    );
    assert.deepEqual(
      trace.map((entry) => [entry.depth, entry.event_type]),
      [
        [0, "learning_item.completed"],
        [1, "XP_CHANGED"],
        [2, "XP_CHANGED"],
        [2, "LEVEL_UP"],
      ]
    );
  });

  it("leaves state untouched for an event no rule cares about", () => {
    const { state, mutations } = processEvent(
      {
        event_type: "platform.session.started",
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
