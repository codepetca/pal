const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type StoryWeekCalendar = {
  termStartDay: string;
  termEndDay: string;
  timeZone: string;
  weekIndex: number;
  weekStartDay: string;
};

function calendarDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoWeekday(day: string): number | null {
  if (addCalendarDays(day, 0) === null) return null;
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function followingInstructionalDay(day: string): string | null {
  const weekday = isoWeekday(day);
  if (weekday === null) return null;
  return addCalendarDays(day, weekday <= 5 ? 0 : 8 - weekday);
}

function mondayOfCalendarWeek(day: string): string | null {
  const weekday = isoWeekday(day);
  return weekday === null ? null : addCalendarDays(day, -(weekday - 1));
}

/**
 * Resolves a story ordinal onto Pal's Monday-Friday instructional calendar.
 * Week 1 begins on the first instructional day on/after the term start. Week 2
 * begins on the following Monday, and later ordinals advance in seven-day
 * steps. Explicit starts may add breaks, but weekend starts normalize to the
 * following Monday and cannot overlap adjacent term-edge weeks.
 */
export function storyWeekStartDay(
  metadata: Record<string, unknown>,
): string | null {
  const termStartDay = metadata.term_start_day;
  const termEndDay = metadata.term_end_day;
  const weekIndex = metadata.week_index;
  const termWeekCount = metadata.term_week_count ?? 16;
  if (
    typeof termStartDay !== "string" ||
    typeof termEndDay !== "string" ||
    !Number.isInteger(weekIndex) ||
    !Number.isInteger(termWeekCount) ||
    (weekIndex as number) < 1 ||
    (weekIndex as number) > (termWeekCount as number) ||
    (termWeekCount as number) < 6 ||
    (termWeekCount as number) > 24 ||
    termStartDay > termEndDay
  ) return null;

  const firstStart = followingInstructionalDay(termStartDay);
  const termEndWeekday = isoWeekday(termEndDay);
  if (!firstStart || termEndWeekday === null || firstStart > termEndDay) return null;
  const firstWeekday = isoWeekday(firstStart)!;
  const secondStart = addCalendarDays(firstStart, 8 - firstWeekday);
  const defaultStart = (weekIndex as number) === 1
    ? firstStart
    : secondStart
      ? addCalendarDays(secondStart, ((weekIndex as number) - 2) * 7)
      : null;
  const explicit = typeof metadata.week_start_day === "string"
    ? (weekIndex as number) === (termWeekCount as number) &&
        (isoWeekday(metadata.week_start_day) ?? 0) > 5
      ? mondayOfCalendarWeek(metadata.week_start_day)
      : followingInstructionalDay(metadata.week_start_day)
    : null;
  if (metadata.week_start_day !== undefined && explicit === null) return null;
  const actualStart = explicit ?? defaultStart;

  const finalMonday = addCalendarDays(termEndDay, -(termEndWeekday - 1));
  const latestStart = finalMonday
    ? (weekIndex as number) === 1
      ? addCalendarDays(finalMonday, -((termWeekCount as number) - 2) * 7 - 3)
      : addCalendarDays(
          finalMonday,
          -((termWeekCount as number) - (weekIndex as number)) * 7,
        )
    : null;
  return actualStart && defaultStart && latestStart &&
      actualStart >= defaultStart && actualStart <= latestStart && actualStart <= termEndDay
    ? actualStart
    : null;
}

export function addCalendarDays(day: string, count: number): string | null {
  if (!ISO_DAY.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || calendarDay(date) !== day) return null;
  return calendarDay(new Date(date.getTime() + count * DAY_MS));
}

export function calendarDayInTimeZone(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: "year" | "month" | "day") =>
      parts.find((part) => part.type === type)?.value ?? "";
    const day = `${value("year")}-${value("month")}-${value("day")}`;
    return ISO_DAY.test(day) ? day : null;
  } catch {
    return null;
  }
}

export function storyWeekCalendar(
  metadata: Record<string, unknown>,
): StoryWeekCalendar | null {
  const termStartDay = metadata.term_start_day;
  const termEndDay = metadata.term_end_day;
  const timeZone = metadata.term_timezone;
  const weekIndex = metadata.week_index;
  if (
    typeof termStartDay !== "string" ||
    typeof termEndDay !== "string" ||
    typeof timeZone !== "string" ||
    !Number.isInteger(weekIndex) ||
    (weekIndex as number) < 1 ||
    addCalendarDays(termStartDay, 0) === null ||
    addCalendarDays(termEndDay, 0) === null ||
    calendarDayInTimeZone(new Date(0), timeZone) === null
  ) {
    return null;
  }
  const weekStartDay = storyWeekStartDay(metadata);
  if (
    weekStartDay === null ||
    addCalendarDays(weekStartDay, 0) === null ||
    weekStartDay < termStartDay ||
    weekStartDay > termEndDay
  ) {
    return null;
  }
  return {
    termStartDay,
    termEndDay,
    timeZone,
    weekIndex: weekIndex as number,
    weekStartDay,
  };
}

/** Returns the last instructional day in this Monday-Friday story week. */
export function storyInstructionalEndDay(
  metadata: Record<string, unknown>,
): string | null {
  const calendar = storyWeekCalendar(metadata);
  if (!calendar) return null;
  const start = new Date(`${calendar.weekStartDay}T00:00:00.000Z`);
  const isoWeekday = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  const daysUntilFriday = (5 - isoWeekday + 7) % 7;
  const friday = addCalendarDays(calendar.weekStartDay, daysUntilFriday);
  if (!friday) return null;
  const instructionalEnd = calendar.termEndDay < friday
    ? calendar.termEndDay
    : friday;
  return instructionalEnd < calendar.weekStartDay ? null : instructionalEnd;
}

/**
 * The instructional week ends on its own Friday, clamped to the authoritative
 * term end. It deliberately does not inspect the next instructional week,
 * because a holiday or break may move that later start without extending this
 * week's collectible boundary.
 */
export function storyCollectibleDueDay(
  metadata: Record<string, unknown>,
): string | null {
  const instructionalEnd = storyInstructionalEndDay(metadata);
  if (!instructionalEnd) return null;
  return addCalendarDays(instructionalEnd, 1);
}

export function isStoryCollectibleDue(
  metadata: Record<string, unknown>,
  asOf: Date,
): boolean {
  const calendar = storyWeekCalendar(metadata);
  const dueDay = storyCollectibleDueDay(metadata);
  if (!calendar || !dueDay) return false;
  const asOfDay = calendarDayInTimeZone(asOf, calendar.timeZone);
  return Boolean(asOfDay && asOfDay >= dueDay);
}
