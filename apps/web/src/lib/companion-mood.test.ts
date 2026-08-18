import assert from "node:assert/strict";
import test from "node:test";

import { companionMood } from "./learner-snapshot";

const TORONTO = "America/Toronto";

/** A local wall-clock time in Toronto, expressed as the UTC instant behind it. */
function torontoInstant(iso: string): Date {
  // August is EDT (UTC-4), so a 04:00 offset recovers the local time under test.
  return new Date(`${iso}-04:00`);
}

test("a resting pet sleeps from 21:30 until 07:30 local", () => {
  const asleep = ["2026-08-17T21:30:00", "2026-08-17T23:59:00", "2026-08-18T07:29:00"];
  for (const at of asleep) {
    assert.equal(
      companionMood("neutral", null, torontoInstant(at), TORONTO),
      "sleeping",
      `${at} should be sleeping`,
    );
  }
});

test("a resting pet is awake outside the night window", () => {
  const awake = ["2026-08-17T07:30:00", "2026-08-17T12:00:00", "2026-08-17T21:29:00"];
  for (const at of awake) {
    assert.equal(
      companionMood("neutral", null, torontoInstant(at), TORONTO),
      "neutral",
      `${at} should be awake`,
    );
  }
});

test("the window wraps midnight rather than spanning a single range", () => {
  assert.equal(
    companionMood("neutral", null, torontoInstant("2026-08-18T00:30:00"), TORONTO),
    "sleeping",
  );
});

test("a running mood interrupts the night and holds its own window", () => {
  const at = torontoInstant("2026-08-17T22:00:00");
  const laterTonight = torontoInstant("2026-08-17T22:30:00");
  assert.equal(companionMood("happy", laterTonight, at, TORONTO), "happy");
  assert.equal(companionMood("excited", laterTonight, at, TORONTO), "excited");
});

test("an expired mood falls through to sleeping at night", () => {
  const at = torontoInstant("2026-08-17T22:00:00");
  const alreadyOver = torontoInstant("2026-08-17T21:00:00");
  assert.equal(companionMood("happy", alreadyOver, at, TORONTO), "sleeping");
});

test("an expired mood still rests as neutral during the day", () => {
  const at = torontoInstant("2026-08-17T12:00:00");
  const alreadyOver = torontoInstant("2026-08-17T11:00:00");
  assert.equal(companionMood("happy", alreadyOver, at, TORONTO), "neutral");
});

test("the term timezone decides the hour, not the server's clock", () => {
  // 2026-08-18T02:00Z is 22:00 the previous evening in Toronto (asleep) and
  // 11:00 the same morning in Tokyo (awake).
  const at = new Date("2026-08-18T02:00:00Z");
  assert.equal(companionMood("neutral", null, at, TORONTO), "sleeping");
  assert.equal(companionMood("neutral", null, at, "Asia/Tokyo"), "neutral");
});

test("a term with no authoritative timezone falls back to UTC", () => {
  assert.equal(
    companionMood("neutral", null, new Date("2026-08-18T02:00:00Z"), undefined),
    "sleeping",
  );
  assert.equal(
    companionMood("neutral", null, new Date("2026-08-18T12:00:00Z"), undefined),
    "neutral",
  );
});

test("an unknown stored mood is treated as resting", () => {
  assert.equal(
    companionMood("zoomies", null, torontoInstant("2026-08-17T12:00:00"), TORONTO),
    "neutral",
  );
});
