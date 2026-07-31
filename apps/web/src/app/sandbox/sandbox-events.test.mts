import assert from "node:assert/strict";
import test from "node:test";
import { v1 } from "@pal/contract";
import { addDays, eventForAction, isTodayOrEarlier } from "./sandbox-events";

const learnerId = "sandbox-00000000-0000-4000-8000-000000000001";

test("builds contract-valid events from the simulated date", () => {
  const simulatedDate = new Date("2026-07-14T08:00:00Z");
  for (const action of [
    "session-started",
    "daily-log-completed",
    "on-time-finish",
    "late-finish",
  ] as const) {
    const event = eventForAction(action, simulatedDate, learnerId);
    assert.ok(event);
    assert.equal(v1.validateV1Event(event).ok, true);
  }

  const dailyLog = eventForAction("daily-log-completed", simulatedDate, learnerId);
  assert.equal(dailyLog?.metadata.activity_day, "2026-07-14");
  assert.equal(dailyLog?.occurred_at.slice(0, 10), dailyLog?.metadata.activity_day);
});

test("date controls cannot advance beyond the ingestable UTC day", () => {
  const today = new Date("2026-07-31T20:00:00Z");
  assert.equal(isTodayOrEarlier(addDays(today, 1), today), false);
  assert.equal(
    isTodayOrEarlier(new Date("2026-07-31T23:59:59Z"), today),
    true,
  );
});
