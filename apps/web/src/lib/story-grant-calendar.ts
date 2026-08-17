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

function isStartOfCalendarDayInTimeZone(
  date: Date,
  timeZone: string,
): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = (type: "hour" | "minute" | "second") =>
      parts.find((part) => part.type === type)?.value ?? "";
    return (
      value("hour") === "00" &&
      value("minute") === "00" &&
      value("second") === "00" &&
      date.getUTCMilliseconds() === 0
    );
  } catch {
    return false;
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
  const weekStartDay = typeof metadata.week_start_day === "string"
    ? metadata.week_start_day
    : addCalendarDays(termStartDay, ((weekIndex as number) - 1) * 7);
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

/**
 * The instructional week ends on its own Friday, clamped to the authoritative
 * term end. It deliberately does not inspect the next instructional week,
 * because a holiday or break may move that later start without extending this
 * week's collectible boundary.
 */
export function storyCollectibleDueDay(
  metadata: Record<string, unknown>,
): string | null {
  const calendar = storyWeekCalendar(metadata);
  if (!calendar) return null;
  const start = new Date(`${calendar.weekStartDay}T00:00:00.000Z`);
  const isoWeekday = start.getUTCDay() === 0 ? 7 : start.getUTCDay();
  if (isoWeekday > 5) return null;
  const friday = addCalendarDays(calendar.weekStartDay, 5 - isoWeekday);
  if (!friday) return null;
  const instructionalEnd = calendar.termEndDay < friday
    ? calendar.termEndDay
    : friday;
  if (instructionalEnd < calendar.weekStartDay) return null;
  return addCalendarDays(instructionalEnd, 1);
}

export function isStoryCollectibleDue(
  metadata: Record<string, unknown>,
  asOf: Date,
  rolloutEffectiveAt: Date,
): boolean {
  const calendar = storyWeekCalendar(metadata);
  const dueDay = storyCollectibleDueDay(metadata);
  if (!calendar || !dueDay) return false;
  const asOfDay = calendarDayInTimeZone(asOf, calendar.timeZone);
  const rolloutDay = calendarDayInTimeZone(
    rolloutEffectiveAt,
    calendar.timeZone,
  );
  return Boolean(
    asOfDay &&
      rolloutDay &&
      (dueDay > rolloutDay ||
        (dueDay === rolloutDay &&
          isStartOfCalendarDayInTimeZone(
            rolloutEffectiveAt,
            calendar.timeZone,
          ))) &&
      asOfDay >= dueDay,
  );
}
