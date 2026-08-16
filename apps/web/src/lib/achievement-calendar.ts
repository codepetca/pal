import type { IncomingEvent } from "@pal/engine";

export type TermCalendarMetadata = {
  term_token: string;
  term_start_day: string;
  term_end_day: string;
  term_timezone: string;
  term_week_count?: number;
  week_start_day?: string;
  week_index: number;
};

export type PeriodCalendar = {
  timeZone: string | null;
  startDay: string | null;
  endDay: string | null;
};

function validatedString(event: IncomingEvent, key: string): string {
  const value = event.metadata[key];
  if (typeof value !== "string") {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value;
}

function validatedInteger(event: IncomingEvent, key: string): number {
  const value = event.metadata[key];
  if (!Number.isInteger(value)) {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value as number;
}

export function termCalendarMetadata(
  event: IncomingEvent,
): TermCalendarMetadata | null {
  if (event.event_type !== "daily_log_week.configured") return null;
  if (event.metadata.week_index === undefined) return null;
  return {
    term_token: validatedString(event, "term_token"),
    term_start_day: validatedString(event, "term_start_day"),
    term_end_day: validatedString(event, "term_end_day"),
    term_timezone: validatedString(event, "term_timezone"),
    ...(event.metadata.term_week_count === undefined
      ? {}
      : {
          term_week_count: validatedInteger(event, "term_week_count"),
          week_start_day: validatedString(event, "week_start_day"),
        }),
    week_index: validatedInteger(event, "week_index"),
  };
}

function offsetCalendarDay(day: string, days: number): string | null {
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(timestamp)
    ? null
    : new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

export function periodCalendarFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): PeriodCalendar {
  const timeZone =
    typeof metadata?.term_timezone === "string"
      ? metadata.term_timezone
      : null;
  const termStartDay =
    typeof metadata?.term_start_day === "string"
      ? metadata.term_start_day
      : null;
  const termEndDay =
    typeof metadata?.term_end_day === "string"
      ? metadata.term_end_day
      : null;
  const weekIndex = metadata?.week_index;
  const explicitWeekStart = metadata?.week_start_day;
  const startDay =
    typeof explicitWeekStart === "string"
      ? explicitWeekStart
      : termStartDay && Number.isInteger(weekIndex)
        ? offsetCalendarDay(termStartDay, ((weekIndex as number) - 1) * 7)
        : null;
  const nominalEndDay = startDay ? offsetCalendarDay(startDay, 6) : null;
  const endDay =
    nominalEndDay && termEndDay && termEndDay < nominalEndDay
      ? termEndDay
      : nominalEndDay;
  return { timeZone, startDay, endDay };
}

export function isCompatibleCalendarRevision(
  left: Record<string, unknown>,
  right: TermCalendarMetadata,
): boolean {
  const v1Keys = [
    "term_token",
    "term_start_day",
    "term_end_day",
    "term_timezone",
    "week_index",
  ] as const;
  if (v1Keys.some((key) => left[key] !== right[key])) return false;

  const leftWeekCount = left.term_week_count ?? 16;
  const rightWeekCount = right.term_week_count ?? 16;
  if (leftWeekCount !== rightWeekCount) return false;
  const leftStartDay = periodCalendarFromMetadata(left).startDay;
  const rightStartDay = periodCalendarFromMetadata(right).startDay;
  return leftStartDay !== null && leftStartDay === rightStartDay;
}

export function isCompatibleTermRevision(
  left: Record<string, unknown>,
  right: TermCalendarMetadata,
): boolean {
  if (
    left.term_start_day !== right.term_start_day ||
    left.term_end_day !== right.term_end_day ||
    left.term_timezone !== right.term_timezone
  ) {
    return false;
  }
  const leftWeekCount = left.term_week_count ?? 16;
  const rightWeekCount = right.term_week_count ?? 16;
  return leftWeekCount === rightWeekCount;
}

export function hasValidStoryWeekPosition(
  calendar: TermCalendarMetadata,
): boolean {
  const totalWeeks = calendar.term_week_count ?? 16;
  const earliestStart = offsetCalendarDay(
    calendar.term_start_day,
    (calendar.week_index - 1) * 7,
  );
  const latestStart = offsetCalendarDay(
    calendar.term_end_day,
    -(totalWeeks - calendar.week_index) * 7,
  );
  const actualStart = calendar.week_start_day ?? earliestStart;
  return Boolean(
    earliestStart &&
      latestStart &&
      actualStart &&
      earliestStart <= actualStart &&
      actualStart <= latestStart,
  );
}
