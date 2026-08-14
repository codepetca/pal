import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  learnerFacts,
  rewardNotices,
  weeklyRhythmConfigs,
  type Db,
} from "@pal/db";
import type { IncomingEvent } from "@pal/engine";

export const ACHIEVEMENT_KEYS = {
  firstLogin: "first-pika-login",
  joinedClass: "joined-class",
  weeklyRhythm: "weekly-rhythm",
  readyEarly: "ready-early",
  onTimeFinish: "on-time-finish",
} as const;

const FIRST_WEEKLY_CONFIGURATION_FACT =
  "internal.daily_log_week.first_configuration";
const DAILY_LOG_PENDING_FACT = "internal.daily_log.reward_pending";
const DAILY_LOG_SETTLEMENT_FACT = "internal.daily_log.reward_settlement";
const MAX_DAILY_LOG_DAYS_PER_PERIOD = 5;
const MAX_DAILY_LOG_FACTS_PER_PERIOD = MAX_DAILY_LOG_DAYS_PER_PERIOD * 2;

type AchievementStatus = "earned" | "in-progress" | "incomplete";

interface FactIdentity {
  semanticKey: string;
  periodKey: string | null;
}

export interface RecordedFact {
  id: string;
  periodKey: string | null;
}

function metadataString(event: IncomingEvent, key: string): string {
  const value = event.metadata[key];
  if (typeof value !== "string") {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value;
}

function metadataInteger(event: IncomingEvent, key: string): number {
  const value = event.metadata[key];
  if (!Number.isInteger(value)) {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value as number;
}

function factIdentity(
  event: IncomingEvent,
  idempotencyKey: string,
): FactIdentity {
  switch (event.event_type) {
    case "platform.session.started":
      return { semanticKey: idempotencyKey, periodKey: null };
    case "classroom.joined":
      return {
        semanticKey: metadataString(event, "classroom_token"),
        periodKey: null,
      };
    case "daily_log_week.configured": {
      const periodKey = metadataString(event, "period_key");
      return {
        semanticKey: `${periodKey}:${metadataInteger(event, "config_version")}`,
        periodKey,
      };
    }
    case "daily_log.completed":
      return {
        semanticKey: metadataString(event, "activity_day"),
        periodKey: metadataString(event, "period_key"),
      };
    case "learning_item.viewed":
    case "learning_item.completed":
      return {
        semanticKey: metadataString(event, "item_token"),
        periodKey: metadataString(event, "period_key"),
      };
    default:
      throw new Error(`No semantic identity for ${event.event_type}`);
  }
}

export type WeeklyConfigurationError =
  | "closed_period_revision"
  | "contradictory_period_configuration"
  | "conflicting_period_calendar"
  | "inconsistent_activity_day"
  | "daily_log_period_limit_exceeded";

type TermCalendarMetadata = {
  term_token: string;
  term_start_day: string;
  term_end_day: string;
  term_timezone: string;
  term_week_count?: number;
  week_start_day?: string;
  week_index: number;
};

function termCalendarMetadata(
  event: IncomingEvent,
): TermCalendarMetadata | null {
  if (event.event_type !== "daily_log_week.configured") return null;
  if (event.metadata.week_index === undefined) return null;
  return {
    term_token: metadataString(event, "term_token"),
    term_start_day: metadataString(event, "term_start_day"),
    term_end_day: metadataString(event, "term_end_day"),
    term_timezone: metadataString(event, "term_timezone"),
    ...(event.metadata.term_week_count === undefined
      ? {}
      : {
          term_week_count: metadataInteger(event, "term_week_count"),
          week_start_day: metadataString(event, "week_start_day"),
        }),
    week_index: metadataInteger(event, "week_index"),
  };
}

function isCompatibleCalendarRevision(
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

  const leftAdaptive = left.term_week_count !== undefined;
  const rightAdaptive = right.term_week_count !== undefined;
  const leftWeekCount = leftAdaptive ? left.term_week_count : 16;
  const rightWeekCount = rightAdaptive ? right.term_week_count : 16;
  if (leftWeekCount !== rightWeekCount) return false;
  return !leftAdaptive || !rightAdaptive || left.week_start_day === right.week_start_day;
}

function isCompatibleTermRevision(
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

async function firstConfigurationTimeZone(
  db: Db,
  learnerId: string,
  periodKey: string,
): Promise<string | null> {
  const [marker] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, FIRST_WEEKLY_CONFIGURATION_FACT),
        eq(learnerFacts.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (marker) {
    const timeZone = (marker.metadata as Record<string, unknown>).term_timezone;
    return typeof timeZone === "string" ? timeZone : null;
  }

  // Backward-compatible fallback for periods created before durable first-config
  // markers existed. New periods never depend on timestamp/UUID ordering.
  const [configuration] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, periodKey),
      ),
    )
    .orderBy(asc(learnerFacts.createdAt), asc(learnerFacts.id))
    .limit(1);
  const timeZone = (
    configuration?.metadata as Record<string, unknown> | undefined
  )?.term_timezone;
  return typeof timeZone === "string" ? timeZone : null;
}

type DailyLogFactRow = {
  id: string;
  integrationId: string;
  sourceEventId: string;
  occurredAt: Date;
  metadata: unknown;
};

async function boundedDailyLogFacts(
  db: Db,
  learnerId: string,
  periodKey: string,
): Promise<DailyLogFactRow[]> {
  // Version 1 permits five qualifying days. A configured period may retain up
  // to five immutable, timezone-quarantined facts while corrected days occupy
  // the five reward slots. Read one overflow row so legacy corruption remains
  // detectable without materializing an unbounded result.
  return db
    .select({
      id: learnerFacts.id,
      integrationId: learnerFacts.integrationId,
      sourceEventId: learnerFacts.sourceEventId,
      occurredAt: learnerFacts.occurredAt,
      metadata: learnerFacts.metadata,
    })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log.completed"),
        eq(learnerFacts.periodKey, periodKey),
      ),
    )
    .limit(MAX_DAILY_LOG_FACTS_PER_PERIOD + 1);
}

function calendarValidDailyLogFacts(
  facts: DailyLogFactRow[],
  timeZone: string | null,
): DailyLogFactRow[] {
  if (!timeZone) return facts;
  return facts.filter((fact) => {
    const activityDay = (fact.metadata as Record<string, unknown>).activity_day;
    return (
      typeof activityDay === "string" &&
      calendarDayInTimeZone(fact.occurredAt, timeZone) === activityDay
    );
  });
}

async function validCompletionFacts(
  db: Db,
  learnerId: string,
  periodKey: string,
  firstTimeZoneOverride?: string,
): Promise<DailyLogFactRow[]> {
  const timeZone =
    firstTimeZoneOverride ??
    (await firstConfigurationTimeZone(db, learnerId, periodKey));
  return calendarValidDailyLogFacts(
    await boundedDailyLogFacts(db, learnerId, periodKey),
    timeZone,
  );
}

async function settledCompletionCount(
  db: Db,
  learnerId: string,
  periodKey: string,
  firstTimeZoneOverride?: string,
): Promise<number> {
  const [firstConfigurationMarker] = await db
    .select({ id: learnerFacts.id })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, FIRST_WEEKLY_CONFIGURATION_FACT),
        eq(learnerFacts.periodKey, periodKey),
      ),
    )
    .limit(1);
  const facts = await validCompletionFacts(
    db,
    learnerId,
    periodKey,
    firstTimeZoneOverride,
  );
  if (!firstConfigurationMarker || facts.length === 0) return facts.length;
  const settlementMarkers = await db
    .select({ completionFactId: learnerFacts.semanticKey })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, DAILY_LOG_SETTLEMENT_FACT),
        inArray(
          learnerFacts.semanticKey,
          facts.map((fact) => fact.id),
        ),
      ),
    )
    .limit(MAX_DAILY_LOG_DAYS_PER_PERIOD + 1);
  return settlementMarkers.length;
}

export async function weeklyConfigurationRejection(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<WeeklyConfigurationError | null> {
  if (event.event_type !== "daily_log_week.configured") return null;
  const periodKey = metadataString(event, "period_key");
  const version = metadataInteger(event, "config_version");
  const eligibleDays = metadataInteger(event, "eligible_days");
  const periodStatus = metadataString(event, "period_status");
  const calendar = termCalendarMetadata(event);
  const [existing] = await db
    .select({
      configVersion: weeklyRhythmConfigs.configVersion,
      periodStatus: weeklyRhythmConfigs.periodStatus,
      reconciliationRequired: weeklyRhythmConfigs.reconciliationRequired,
    })
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);
  const firstConfigurationTimeZoneOverride = existing
    ? undefined
    : typeof calendar?.term_timezone === "string"
      ? calendar.term_timezone
      : undefined;
  if (
    periodStatus === "closed" &&
    eligibleDays <
      (await validCompletionFacts(
        db,
        learnerId,
        periodKey,
        firstConfigurationTimeZoneOverride,
      )).length
  ) {
    return "contradictory_period_configuration";
  }
  if (
    existing?.periodStatus === "closed" &&
    version > existing.configVersion &&
    (!existing.reconciliationRequired || periodStatus !== "closed")
  ) {
    return "closed_period_revision";
  }
  if (calendar) {
    const [samePeriodCalendar] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          eq(learnerFacts.periodKey, periodKey),
          sql`${learnerFacts.metadata} ? 'week_index'`,
        ),
      )
      .orderBy(
        sql`(${learnerFacts.metadata} ? 'term_week_count') desc`,
        sql`(${learnerFacts.metadata}->>'config_version')::int desc`,
      )
      .limit(1);
    if (
      samePeriodCalendar &&
      (samePeriodCalendar.metadata as Record<string, unknown>).week_index !== undefined &&
      !isCompatibleCalendarRevision(
        samePeriodCalendar.metadata as Record<string, unknown>,
        calendar,
      )
    ) {
      return "conflicting_period_calendar";
    }

    const [sameTermCalendar] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          sql`${learnerFacts.metadata}->>'term_token' = ${calendar.term_token}`,
        ),
      )
      .orderBy(sql`(${learnerFacts.metadata} ? 'term_week_count') desc`)
      .limit(1);
    if (
      sameTermCalendar &&
      !isCompatibleTermRevision(
        sameTermCalendar.metadata as Record<string, unknown>,
        calendar,
      )
    ) {
      return "conflicting_period_calendar";
    }

    const [occupiedWeek] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          sql`${learnerFacts.metadata}->>'term_token' = ${calendar.term_token}`,
          sql`${learnerFacts.metadata}->>'week_index' = ${String(calendar.week_index)}`,
          sql`${learnerFacts.periodKey} <> ${periodKey}`,
        ),
      )
      .limit(1);
    if (occupiedWeek) return "conflicting_period_calendar";

    if (calendar.week_start_day !== undefined) {
      const [outOfOrderWeek] = await db
        .select({ id: learnerFacts.id })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.eventType, "daily_log_week.configured"),
            sql`${learnerFacts.metadata}->>'term_token' = ${calendar.term_token}`,
            sql`(
              ((${learnerFacts.metadata}->>'week_index')::int < ${calendar.week_index}
                and ${learnerFacts.metadata}->>'week_start_day' >= ${calendar.week_start_day})
              or
              ((${learnerFacts.metadata}->>'week_index')::int > ${calendar.week_index}
                and ${learnerFacts.metadata}->>'week_start_day' <= ${calendar.week_start_day})
            )`,
          ),
        )
        .limit(1);
      if (outOfOrderWeek) return "conflicting_period_calendar";
    }
  }
  return null;
}

function calendarDayInTimeZone(date: Date, timeZone: string): string {
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

export type DailyLogCalendarStatus =
  | "not-daily-log"
  | "pending"
  | "valid"
  | "invalid"
  | "period-limit-exceeded";

export async function dailyLogCalendarStatus(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<DailyLogCalendarStatus> {
  if (event.event_type !== "daily_log.completed") return "not-daily-log";
  const periodKey = metadataString(event, "period_key");
  const existingFacts = await boundedDailyLogFacts(db, learnerId, periodKey);
  const [configuration] = await db
    .select({ id: weeklyRhythmConfigs.id })
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (!configuration) {
    return existingFacts.length >= MAX_DAILY_LOG_DAYS_PER_PERIOD
      ? "period-limit-exceeded"
      : "pending";
  }

  const [calendar] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, periodKey),
        sql`${learnerFacts.metadata} ? 'term_timezone'`,
      ),
    )
    .limit(1);
  const timeZone = (calendar?.metadata as Record<string, unknown> | undefined)
    ?.term_timezone;
  if (
    typeof timeZone === "string" &&
    metadataString(event, "activity_day") !==
      calendarDayInTimeZone(new Date(event.occurred_at), timeZone)
  ) {
    return "invalid";
  }
  const qualifyingFacts = calendarValidDailyLogFacts(
    existingFacts,
    typeof timeZone === "string" ? timeZone : null,
  );
  return qualifyingFacts.length >= MAX_DAILY_LOG_DAYS_PER_PERIOD ||
    existingFacts.length >= MAX_DAILY_LOG_FACTS_PER_PERIOD
    ? "period-limit-exceeded"
    : "valid";
}

export type WeeklyConfigurationDisposition =
  | "not-configuration"
  | "first"
  | "higher"
  | "stale";

export async function weeklyConfigurationDisposition(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<WeeklyConfigurationDisposition> {
  if (event.event_type !== "daily_log_week.configured") {
    return "not-configuration";
  }
  const [configuration] = await db
    .select({ configVersion: weeklyRhythmConfigs.configVersion })
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(
          weeklyRhythmConfigs.periodKey,
          metadataString(event, "period_key"),
        ),
      ),
    )
    .limit(1);
  if (!configuration) return "first";
  return metadataInteger(event, "config_version") > configuration.configVersion
    ? "higher"
    : "stale";
}

export async function recordFirstWeeklyConfigurationMarker(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    event: IncomingEvent;
  },
): Promise<void> {
  if (input.event.event_type !== "daily_log_week.configured") return;
  const periodKey = metadataString(input.event, "period_key");
  const timeZoneValue = termCalendarMetadata(input.event)?.term_timezone;
  await db
    .insert(learnerFacts)
    .values({
      integrationId: input.integrationId,
      learnerId: input.learnerId,
      sourceEventId: input.sourceEventId,
      eventType: FIRST_WEEKLY_CONFIGURATION_FACT,
      semanticKey: periodKey,
      periodKey,
      occurredAt: new Date(input.event.occurred_at),
      metadata:
        typeof timeZoneValue === "string"
          ? { term_timezone: timeZoneValue }
          : {},
    })
    .onConflictDoNothing();
}

async function recordDailyLogSettlement(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    completionFactId: string;
    periodKey: string;
    occurredAt: Date;
  },
): Promise<boolean> {
  const [created] = await db
    .insert(learnerFacts)
    .values({
      integrationId: input.integrationId,
      learnerId: input.learnerId,
      sourceEventId: input.sourceEventId,
      eventType: DAILY_LOG_SETTLEMENT_FACT,
      semanticKey: input.completionFactId,
      periodKey: input.periodKey,
      occurredAt: input.occurredAt,
      metadata: { status: "valid" },
    })
    .onConflictDoNothing()
    .returning({ id: learnerFacts.id });
  return Boolean(created);
}

export async function recordImmediateDailyLogSettlement(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    factId: string;
    event: IncomingEvent;
  },
): Promise<boolean> {
  if (input.event.event_type !== "daily_log.completed") return false;
  return recordDailyLogSettlement(db, {
    integrationId: input.integrationId,
    learnerId: input.learnerId,
    sourceEventId: input.sourceEventId,
    completionFactId: input.factId,
    periodKey: metadataString(input.event, "period_key"),
    occurredAt: new Date(input.event.occurred_at),
  });
}

export async function recordPendingDailyLogReward(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    factId: string;
    event: IncomingEvent;
  },
): Promise<void> {
  if (input.event.event_type !== "daily_log.completed") return;
  await db
    .insert(learnerFacts)
    .values({
      integrationId: input.integrationId,
      learnerId: input.learnerId,
      sourceEventId: input.sourceEventId,
      eventType: DAILY_LOG_PENDING_FACT,
      semanticKey: input.factId,
      periodKey: metadataString(input.event, "period_key"),
      occurredAt: new Date(input.event.occurred_at),
      metadata: { status: "pending" },
    })
    .onConflictDoNothing();
}

export async function settlePendingDailyLogEvents(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<IncomingEvent[]> {
  if (event.event_type !== "daily_log_week.configured") return [];
  const periodKey = metadataString(event, "period_key");
  const eligibleDays = metadataInteger(event, "eligible_days");
  if (eligibleDays === 0) return [];
  const timeZoneValue = termCalendarMetadata(event)?.term_timezone;
  const timeZone = typeof timeZoneValue === "string" ? timeZoneValue : null;
  const boundedFacts = await boundedDailyLogFacts(db, learnerId, periodKey);
  if (boundedFacts.length > MAX_DAILY_LOG_FACTS_PER_PERIOD) return [];

  const existingSettlements = await db
    .select({ completionFactId: learnerFacts.semanticKey })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, DAILY_LOG_SETTLEMENT_FACT),
        eq(learnerFacts.periodKey, periodKey),
      ),
    )
    .limit(MAX_DAILY_LOG_DAYS_PER_PERIOD + 1);
  const existingSettlementIds = new Set(
    existingSettlements.map((marker) => marker.completionFactId),
  );
  const remainingAllowance = Math.max(
    0,
    eligibleDays - existingSettlementIds.size,
  );
  if (remainingAllowance === 0) return [];

  const candidates = calendarValidDailyLogFacts(boundedFacts, timeZone)
    .filter((fact) => !existingSettlementIds.has(fact.id))
    .toSorted((left, right) => {
      const leftDay = String(
        (left.metadata as Record<string, unknown>).activity_day,
      );
      const rightDay = String(
        (right.metadata as Record<string, unknown>).activity_day,
      );
      return (
        leftDay.localeCompare(rightDay) ||
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.id.localeCompare(right.id)
      );
    })
    .slice(0, remainingAllowance);
  const pendingMarkers = candidates.length
    ? await db
        .select({ completionFactId: learnerFacts.semanticKey })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.eventType, DAILY_LOG_PENDING_FACT),
            inArray(
              learnerFacts.semanticKey,
              candidates.map((fact) => fact.id),
            ),
          ),
        )
    : [];
  const rewardPendingIds = new Set(
    pendingMarkers.map((marker) => marker.completionFactId),
  );
  const newlyRewardableFacts: DailyLogFactRow[] = [];
  for (const fact of candidates) {
    const created = await recordDailyLogSettlement(db, {
      integrationId: fact.integrationId,
      learnerId,
      sourceEventId: fact.sourceEventId,
      completionFactId: fact.id,
      periodKey,
      occurredAt: fact.occurredAt,
    });
    if (created && rewardPendingIds.has(fact.id)) {
      newlyRewardableFacts.push(fact);
    }
  }
  return newlyRewardableFacts.map(({ occurredAt, metadata }) => ({
      event_type: "daily_log.completed" as const,
      occurred_at: occurredAt.toISOString(),
      metadata: metadata as IncomingEvent["metadata"],
    }));
}

function authoritativePeriodAnchor(event: IncomingEvent): Date {
  if (event.event_type === "daily_log.completed") {
    return new Date(`${metadataString(event, "activity_day")}T00:00:00.000Z`);
  }
  return new Date(event.occurred_at);
}

async function ensurePeriod(
  db: Db,
  learnerId: string,
  periodKey: string | null,
  event: IncomingEvent,
): Promise<void> {
  if (!periodKey) return;
  const anchorAt = authoritativePeriodAnchor(event);
  const [existing] = await db
    .select({ id: achievementPeriods.id, anchorAt: achievementPeriods.anchorAt })
    .from(achievementPeriods)
    .where(
      and(
        eq(achievementPeriods.learnerId, learnerId),
        eq(achievementPeriods.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (anchorAt.getTime() < existing.anchorAt.getTime()) {
      await db
        .update(achievementPeriods)
        .set({ anchorAt })
        .where(eq(achievementPeriods.id, existing.id));
    }
    return;
  }

  await db.insert(achievementPeriods).values({
    learnerId,
    periodKey,
    anchorAt,
  });
}

export async function recordSemanticFact(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    event: IncomingEvent;
    idempotencyKey: string;
  },
): Promise<RecordedFact | null> {
  const identity = factIdentity(input.event, input.idempotencyKey);
  const [fact] = await db
    .insert(learnerFacts)
    .values({
      integrationId: input.integrationId,
      learnerId: input.learnerId,
      sourceEventId: input.sourceEventId,
      eventType: input.event.event_type,
      semanticKey: identity.semanticKey,
      periodKey: identity.periodKey,
      occurredAt: new Date(input.event.occurred_at),
      metadata: input.event.metadata,
    })
    .onConflictDoNothing()
    .returning({ id: learnerFacts.id });
  if (!fact) return null;
  await ensurePeriod(db, input.learnerId, identity.periodKey, input.event);
  return { id: fact.id, periodKey: identity.periodKey };
}

export async function semanticFactAlreadyRecorded(
  db: Db,
  input: {
    learnerId: string;
    event: IncomingEvent;
    idempotencyKey: string;
  },
): Promise<boolean> {
  const identity = factIdentity(input.event, input.idempotencyKey);
  const [existing] = await db
    .select({ id: learnerFacts.id })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, input.learnerId),
        eq(learnerFacts.eventType, input.event.event_type),
        eq(learnerFacts.semanticKey, identity.semanticKey),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function createScopedOutcome(
  db: Db,
  input: {
    learnerId: string;
    achievementKey: string;
    scopeKey: string;
    periodKey: string | null;
    status: AchievementStatus;
    factId: string;
    occurredAt: Date;
  },
): Promise<{ id: string; created: boolean }> {
  const [created] = await db
    .insert(achievementInstances)
    .values({
      learnerId: input.learnerId,
      achievementKey: input.achievementKey,
      scopeKey: input.scopeKey,
      periodKey: input.periodKey,
      status: input.status,
      earnedAt: input.status === "earned" ? input.occurredAt : null,
      sourceFactId: input.factId,
    })
    .onConflictDoNothing()
    .returning({ id: achievementInstances.id });
  if (created) return { id: created.id, created: true };

  const [existing] = await db
    .select({ id: achievementInstances.id })
    .from(achievementInstances)
    .where(
      and(
        eq(achievementInstances.learnerId, input.learnerId),
        eq(achievementInstances.achievementKey, input.achievementKey),
        eq(achievementInstances.scopeKey, input.scopeKey),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Failed to resolve achievement instance");
  return { id: existing.id, created: false };
}

function weeklyTarget(eligibleDays: number): number {
  if (eligibleDays <= 2) return eligibleDays;
  return eligibleDays - 1;
}

async function recomputeWeeklyRhythm(
  db: Db,
  learnerId: string,
  periodKey: string,
  factId: string,
  occurredAt: Date,
): Promise<boolean> {
  const [configuration] = await db
    .select()
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (!configuration) return false;

  const current = await settledCompletionCount(db, learnerId, periodKey);
  const targetDays = weeklyTarget(configuration.eligibleDays);
  const reconciliationRequired = current > configuration.eligibleDays;
  if (configuration.reconciliationRequired !== reconciliationRequired) {
    await db
      .update(weeklyRhythmConfigs)
      .set({ reconciliationRequired, updatedAt: new Date() })
      .where(eq(weeklyRhythmConfigs.id, configuration.id));
  }

  const [existing] = await db
    .select()
    .from(achievementInstances)
    .where(
      and(
        eq(achievementInstances.learnerId, learnerId),
        eq(achievementInstances.achievementKey, ACHIEVEMENT_KEYS.weeklyRhythm),
        eq(achievementInstances.scopeKey, periodKey),
      ),
    )
    .limit(1);

  if (targetDays === 0 && !reconciliationRequired) {
    if (existing && existing.status !== "earned") {
      await db
        .delete(achievementInstances)
        .where(eq(achievementInstances.id, existing.id));
    }
    return false;
  }

  // An award is historical. Open-period revisions may recompute only an
  // unawarded target; they never revoke or visually weaken an earned instance.
  if (existing?.status === "earned") return false;

  const earned =
    !reconciliationRequired && current >= targetDays;
  const status: AchievementStatus =
    reconciliationRequired
      ? "in-progress"
      : earned
      ? "earned"
      : configuration.periodStatus === "closed"
        ? "incomplete"
        : "in-progress";
  const displayTarget = reconciliationRequired
    ? Math.max(targetDays, current + 1)
    : targetDays;
  // The fact ledger preserves every distinct completion, including a fifth log
  // in a 5-eligible-day week. Snapshot progress represents target completion,
  // however, and the public schema correctly rejects current > target.
  const displayCurrent = earned ? targetDays : current;

  if (existing) {
    await db
      .update(achievementInstances)
      .set({
        status,
        progressCurrent: displayCurrent,
        progressTarget: displayTarget,
        earnedAt:
          existing.earnedAt ?? (status === "earned" ? occurredAt : null),
        sourceFactId: factId,
        updatedAt: new Date(),
      })
      .where(eq(achievementInstances.id, existing.id));
    return status === "earned";
  }

  await db.insert(achievementInstances).values({
    learnerId,
    achievementKey: ACHIEVEMENT_KEYS.weeklyRhythm,
    scopeKey: periodKey,
    periodKey,
    status,
    progressCurrent: displayCurrent,
    progressTarget: displayTarget,
    earnedAt: status === "earned" ? occurredAt : null,
    sourceFactId: factId,
  });
  return status === "earned";
}

async function applyWeeklyConfiguration(
  db: Db,
  learnerId: string,
  fact: RecordedFact,
  event: IncomingEvent,
): Promise<boolean> {
  const periodKey = metadataString(event, "period_key");
  const version = metadataInteger(event, "config_version");
  const eligibleDays = metadataInteger(event, "eligible_days");
  const periodStatus = metadataString(event, "period_status");
  const [existing] = await db
    .select()
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(weeklyRhythmConfigs).values({
      learnerId,
      periodKey,
      configVersion: version,
      periodStatus,
      eligibleDays,
      configuredAt: new Date(event.occurred_at),
    });
  } else if (version > existing.configVersion) {
    await db
      .update(weeklyRhythmConfigs)
      .set({
        configVersion: version,
        periodStatus,
        eligibleDays,
        configuredAt: new Date(event.occurred_at),
        updatedAt: new Date(),
      })
      .where(eq(weeklyRhythmConfigs.id, existing.id));
  }

  return recomputeWeeklyRhythm(
    db,
    learnerId,
    periodKey,
    fact.id,
    new Date(event.occurred_at),
  );
}

export async function earnedWeeklyRhythmCount(
  db: Db,
  learnerId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(achievementInstances)
    .where(
      and(
        eq(achievementInstances.learnerId, learnerId),
        eq(achievementInstances.achievementKey, ACHIEVEMENT_KEYS.weeklyRhythm),
        eq(achievementInstances.status, "earned"),
      ),
    );
  return row?.value ?? 0;
}

export type AchievementFactResult = {
  weeklyRhythmEarnedCount?: number;
};

export async function applyAchievementFact(
  db: Db,
  learnerId: string,
  fact: RecordedFact,
  event: IncomingEvent,
): Promise<AchievementFactResult> {
  const occurredAt = new Date(event.occurred_at);
  switch (event.event_type) {
    case "platform.session.started":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.firstLogin,
        scopeKey: "lifetime",
        periodKey: null,
        status: "earned",
        factId: fact.id,
        occurredAt,
      });
      return {};
    case "classroom.joined":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.joinedClass,
        scopeKey: metadataString(event, "classroom_token"),
        periodKey: null,
        status: "earned",
        factId: fact.id,
        occurredAt,
      });
      return {};
    case "daily_log_week.configured":
      if (await applyWeeklyConfiguration(db, learnerId, fact, event)) {
        return {
          weeklyRhythmEarnedCount: await earnedWeeklyRhythmCount(db, learnerId),
        };
      }
      return {};
    case "daily_log.completed": {
      const earned = await recomputeWeeklyRhythm(
        db,
        learnerId,
        metadataString(event, "period_key"),
        fact.id,
        occurredAt,
      );
      return earned
        ? {
            weeklyRhythmEarnedCount: await earnedWeeklyRhythmCount(db, learnerId),
          }
        : {};
    }
    case "learning_item.viewed":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.readyEarly,
        scopeKey: metadataString(event, "item_token"),
        periodKey: fact.periodKey,
        status:
          metadataString(event, "timing") === "within_24h_of_release"
            ? "earned"
            : "incomplete",
        factId: fact.id,
        occurredAt,
      });
      return {};
    case "learning_item.completed": {
      const earned = metadataString(event, "timing") === "on_time";
      const outcome = await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.onTimeFinish,
        scopeKey: metadataString(event, "item_token"),
        periodKey: fact.periodKey,
        status: earned ? "earned" : "incomplete",
        factId: fact.id,
        occurredAt,
      });
      if (earned && outcome.created) {
        await db
          .insert(rewardNotices)
          .values({
            learnerId,
            achievementInstanceId: outcome.id,
            rewardKey: "fish-snack-v1",
            title: "A treat for Pip!",
            description: "Your on-time work earned a fish snack.",
            icon: "🐟",
          })
          .onConflictDoNothing();
      }
      return {};
    }
  }
  return {};
}
