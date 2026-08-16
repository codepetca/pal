import { and, desc, eq, sql } from "drizzle-orm";
import { learnerFacts, type Db } from "@pal/db";

export type CalendarFact = {
  periodKey: string | null;
  occurredAt: Date;
  metadata: unknown;
};

export function calendarDayInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function loadCurrentTermCalendarFacts(
  db: Db,
  learnerId: string,
  asOf: Date,
): Promise<{ selectedTermFact?: CalendarFact; facts: CalendarFact[] }> {
  const asOfDay = sql<string>`to_char(
    ${asOf} at time zone (${learnerFacts.metadata}->>'term_timezone'),
    'YYYY-MM-DD'
  )`;
  const termStart = sql<string>`${learnerFacts.metadata}->>'term_start_day'`;
  const termEnd = sql<string>`${learnerFacts.metadata}->>'term_end_day'`;
  const calendarFilter = and(
    eq(learnerFacts.learnerId, learnerId),
    eq(learnerFacts.eventType, "daily_log_week.configured"),
    sql`${learnerFacts.metadata} ?& array['term_token', 'term_start_day', 'term_end_day', 'term_timezone']`,
  );
  const [selectedTermFact] = await db
    .select({
      periodKey: learnerFacts.periodKey,
      occurredAt: learnerFacts.occurredAt,
      metadata: learnerFacts.metadata,
    })
    .from(learnerFacts)
    .where(calendarFilter)
    .orderBy(
      sql`case
        when ${termStart} <= ${asOfDay} and ${asOfDay} <= ${termEnd} then 0
        when ${termEnd} < ${asOfDay} then 1
        else 2
      end`,
      sql`case when ${termStart} <= ${asOfDay} and ${asOfDay} <= ${termEnd} then ${termStart} end desc`,
      sql`case when ${termEnd} < ${asOfDay} then ${termEnd} end desc`,
      sql`case when ${termStart} > ${asOfDay} then ${termStart} end asc`,
      desc(learnerFacts.occurredAt),
    )
    .limit(1);
  if (!selectedTermFact) return { facts: [] };

  const termToken = (selectedTermFact.metadata as Record<string, unknown>)
    .term_token as string;
  const facts = await db
    .selectDistinctOn([learnerFacts.periodKey], {
      periodKey: learnerFacts.periodKey,
      occurredAt: learnerFacts.occurredAt,
      metadata: learnerFacts.metadata,
    })
    .from(learnerFacts)
    .where(
      and(
        calendarFilter,
        sql`${learnerFacts.metadata}->>'term_token' = ${termToken}`,
      ),
    )
    .orderBy(
      learnerFacts.periodKey,
      sql`(${learnerFacts.metadata} ? 'term_week_count') desc`,
      sql`(${learnerFacts.metadata}->>'config_version')::int desc`,
      desc(learnerFacts.occurredAt),
    )
    .limit(24);
  return { selectedTermFact, facts };
}

export function nextCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
