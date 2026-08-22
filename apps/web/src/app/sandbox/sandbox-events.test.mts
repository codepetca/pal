import assert from "node:assert/strict";
import test from "node:test";
import { v1 } from "@pal/contract";
import {
  FICTIONAL_SEMESTER_END_DAY,
  FICTIONAL_SEMESTER_START_ISO,
  FICTIONAL_TERM_TIME_ZONE,
  addDays,
  eventForAction,
  eventsForAction,
  isTodayOrEarlier,
  isInsideFictionalSemester,
  periodKeyForDate,
  semesterWeekForDate,
} from "./sandbox-events";

const learnerId = "sandbox-00000000-0000-4000-8000-000000000001";

test("builds all six contract-valid pilot facts", () => {
  const simulatedDate = new Date("2026-04-14T08:00:00Z");
  const now = new Date("2026-07-31T20:00:00Z");
  const events = [
    "session-started",
    "classroom-joined",
    "week-configured",
    "daily-log-completed",
    "item-opened-early",
    "on-time-finish",
  ].map((action) =>
    eventForAction(action as Parameters<typeof eventForAction>[0], simulatedDate, learnerId, now),
  );

  assert.equal(events.every((event) => event && v1.validateV1Event(event).ok), true);
  assert.deepEqual(
    events.map((event) => event?.event_type),
    [
      "platform.session.started",
      "classroom.joined",
      "daily_log_week.configured",
      "daily_log.completed",
      "learning_item.viewed",
      "learning_item.completed",
    ],
  );

  const dailyLog = events[3];
  assert.equal(dailyLog?.metadata.activity_day, "2026-04-14");
  assert.equal(dailyLog?.occurred_at.slice(0, 10), dailyLog?.metadata.activity_day);

  assert.equal(events[0]?.occurred_at, simulatedDate.toISOString());
  assert.equal(events[1]?.occurred_at, simulatedDate.toISOString());

  const completion = events[5];
  assert.equal(completion?.occurred_at, now.toISOString());

  const configuredWeek = events[2];
  assert.deepEqual(
    configuredWeek?.metadata,
    {
      period_key: "sandbox-week-01",
      config_version: 1,
      period_status: "open",
      eligible_days: 5,
      term_token: "sandbox-term-2026",
      term_start_day: FICTIONAL_SEMESTER_START_ISO.slice(0, 10),
      term_end_day: FICTIONAL_SEMESTER_END_DAY,
      term_timezone: FICTIONAL_TERM_TIME_ZONE,
      term_week_count: 16,
      week_start_day: "2026-04-13",
      week_index: 1,
    },
  );
});

test("maps the fictional semester to stable, distinct week keys", () => {
  const weekOne = new Date("2026-04-13T08:00:00Z");
  const weekTwo = addDays(weekOne, 7);
  assert.equal(semesterWeekForDate(weekOne), 1);
  assert.equal(semesterWeekForDate(weekTwo), 2);
  assert.equal(periodKeyForDate(weekOne), "sandbox-week-01");
  assert.equal(periodKeyForDate(weekTwo), "sandbox-week-02");
  assert.equal(semesterWeekForDate(addDays(weekOne, 200)), 16);
});

test("creates a new semantic item identity for each genuine item action", () => {
  const date = new Date("2026-04-14T08:00:00Z");
  const first = eventForAction("on-time-finish", date, learnerId);
  const second = eventForAction("on-time-finish", date, learnerId);
  assert.notEqual(first?.metadata.item_token, second?.metadata.item_token);
  assert.notEqual(first?.idempotency_key, second?.idempotency_key);
});

test("anchors a fictional week before a wall-clock item reaction", () => {
  const simulatedDate = new Date("2026-04-14T08:00:00Z");
  const now = new Date("2026-08-02T15:00:00Z");
  const events = eventsForAction(
    "on-time-finish",
    simulatedDate,
    learnerId,
    now,
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].event_type, "daily_log_week.configured");
  assert.equal(events[0].occurred_at, simulatedDate.toISOString());
  assert.equal(events[0].metadata.period_key, "sandbox-week-01");
  assert.equal(events[1].event_type, "learning_item.completed");
  assert.equal(events[1].occurred_at, now.toISOString());
  assert.equal(events[1].metadata.period_key, "sandbox-week-01");
});

test("configures Weekly Rhythm before a daily log can advance it", () => {
  const simulatedDate = new Date("2026-04-14T08:00:00Z");
  const events = eventsForAction(
    "daily-log-completed",
    simulatedDate,
    learnerId,
    new Date("2026-08-02T15:00:00Z"),
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].event_type, "daily_log_week.configured");
  assert.equal(events[1].event_type, "daily_log.completed");
  assert.equal(events[0].metadata.period_key, events[1].metadata.period_key);
});

test("date controls cannot advance beyond the ingestable UTC day", () => {
  const today = new Date("2026-07-31T20:00:00Z");
  assert.equal(isTodayOrEarlier(addDays(today, 1), today), false);
  assert.equal(
    isTodayOrEarlier(new Date("2026-07-31T23:59:59Z"), today),
    true,
  );
});

test("date controls cannot advance beyond the fictional term", () => {
  assert.equal(isInsideFictionalSemester(new Date("2026-08-02T23:59:59Z")), true);
  assert.equal(isInsideFictionalSemester(new Date("2026-08-03T00:00:00Z")), false);
});
