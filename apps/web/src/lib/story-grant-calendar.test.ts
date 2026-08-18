import assert from "node:assert/strict";
import test from "node:test";

import {
  isStoryCollectibleDue,
  storyCollectibleDueDay,
  storyWeekCalendar,
} from "@/lib/story-grant-calendar";

function calendar(overrides: Record<string, unknown> = {}) {
  return {
    term_start_day: "2026-08-31",
    term_end_day: "2026-12-18",
    term_timezone: "America/Toronto",
    term_week_count: 16,
    week_start_day: "2026-08-31",
    week_index: 1,
    ...overrides,
  };
}

test("a normal Monday-Friday week becomes due Saturday", () => {
  const metadata = calendar();
  assert.equal(storyCollectibleDueDay(metadata), "2026-09-05");
  assert.equal(
    isStoryCollectibleDue(
      metadata,
      new Date("2026-09-05T03:59:59.999Z"),
    ),
    false,
  );
  assert.equal(
    isStoryCollectibleDue(
      metadata,
      new Date("2026-09-05T04:00:00.000Z"),
    ),
    true,
  );
});

test("a midweek semester start still ends its first week on Friday", () => {
  assert.equal(
    storyCollectibleDueDay(calendar({
      term_start_day: "2026-09-02",
      week_start_day: "2026-09-02",
    })),
    "2026-09-05",
  );
});

test("a midweek semester end becomes due the following day", () => {
  assert.equal(
    storyCollectibleDueDay(calendar({
      term_end_day: "2026-12-16",
      week_start_day: "2026-12-14",
      week_index: 16,
    })),
    "2026-12-17",
  );
});

test("a semester ending Friday becomes due Saturday", () => {
  assert.equal(
    storyCollectibleDueDay(calendar({
      week_start_day: "2026-12-14",
      week_index: 16,
    })),
    "2026-12-19",
  );
});

test("a later instructional break does not delay the current week's due day", () => {
  const beforeBreak = calendar({
    term_week_count: 14,
    week_start_day: "2026-10-05",
    week_index: 6,
  });
  const afterBreak = calendar({
    term_week_count: 14,
    week_start_day: "2026-10-26",
    week_index: 7,
  });
  assert.equal(storyCollectibleDueDay(beforeBreak), "2026-10-10");
  assert.equal(storyCollectibleDueDay(afterBreak), "2026-10-31");
});

test("weekend term starts normalize to Monday without overlapping Week 2", () => {
  const first = calendar({
    term_start_day: "2026-09-06",
    term_end_day: "2026-10-16",
    term_week_count: 6,
    week_start_day: "2026-09-06",
  });
  const second = calendar({
    term_start_day: "2026-09-06",
    term_end_day: "2026-10-16",
    term_week_count: 6,
    week_start_day: "2026-09-14",
    week_index: 2,
  });
  assert.equal(storyWeekCalendar(first)?.weekStartDay, "2026-09-07");
  assert.equal(storyCollectibleDueDay(first), "2026-09-12");
  assert.equal(storyWeekCalendar(second)?.weekStartDay, "2026-09-14");
});

test("term slack permits a delayed Week 1 without leaving Monday-Friday", () => {
  const delayed = calendar({
    term_start_day: "2026-08-31",
    term_end_day: "2026-12-18",
    term_week_count: 12,
    week_start_day: "2026-09-07",
  });
  assert.equal(storyWeekCalendar(delayed)?.weekStartDay, "2026-09-07");
  assert.equal(storyCollectibleDueDay(delayed), "2026-09-12");
});

test("a weekend final-week marker resolves to the preceding Monday", () => {
  const finalWeek = calendar({
    term_start_day: "2026-05-11",
    term_end_day: "2026-08-30",
    term_week_count: 16,
    week_start_day: "2026-08-30",
    week_index: 16,
  });
  assert.equal(storyWeekCalendar(finalWeek)?.weekStartDay, "2026-08-24");
  assert.equal(storyCollectibleDueDay(finalWeek), "2026-08-29");
});

test("a Friday final-week marker resolves to Monday and still ends Friday", () => {
  const finalWeek = calendar({
    week_start_day: "2026-12-18",
    week_index: 16,
  });
  assert.equal(storyWeekCalendar(finalWeek)?.weekStartDay, "2026-12-14");
  assert.equal(storyCollectibleDueDay(finalWeek), "2026-12-19");
});

test("legacy 16-week calendars normalize the first and last short weeks", () => {
  const legacy = {
    term_start_day: "2026-09-02",
    term_end_day: "2026-12-16",
    term_timezone: "America/Toronto",
  };
  assert.equal(
    storyWeekCalendar({ ...legacy, week_index: 2 })?.weekStartDay,
    "2026-09-07",
  );
  assert.equal(
    storyWeekCalendar({ ...legacy, week_index: 16 })?.weekStartDay,
    "2026-12-14",
  );
  assert.equal(
    storyCollectibleDueDay({ ...legacy, week_index: 16 }),
    "2026-12-17",
  );
});

test("local calendar comparison remains stable across DST boundaries", () => {
  const metadata = calendar({
    term_start_day: "2026-03-02",
    term_end_day: "2026-06-19",
    term_timezone: "America/New_York",
    week_start_day: "2026-03-09",
    week_index: 2,
  });
  assert.equal(storyCollectibleDueDay(metadata), "2026-03-14");
  assert.equal(
    isStoryCollectibleDue(
      metadata,
      new Date("2026-03-14T03:59:59.999Z"),
    ),
    false,
  );
  assert.equal(
    isStoryCollectibleDue(
      metadata,
      new Date("2026-03-14T04:00:00.000Z"),
    ),
    true,
  );
});

test("local due days are authoritative at both supported offset extremes", () => {
  for (const [timeZone, before, at] of [
    ["Pacific/Kiritimati", "2026-09-04T09:59:59.999Z", "2026-09-04T10:00:00.000Z"],
    ["Etc/GMT+12", "2026-09-05T11:59:59.999Z", "2026-09-05T12:00:00.000Z"],
  ] as const) {
    const metadata = calendar({ term_timezone: timeZone });
    assert.equal(isStoryCollectibleDue(metadata, new Date(before)), false);
    assert.equal(isStoryCollectibleDue(metadata, new Date(at)), true);
  }
});

test("malformed calendars fail closed", () => {
  assert.equal(
    storyCollectibleDueDay(calendar({ term_timezone: "Not/A_Timezone" })),
    null,
  );
  assert.equal(storyCollectibleDueDay(calendar({ week_start_day: "nope" })), null);
});
