import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  learnerFacts,
  rewardNotices,
  weeklyRhythmConfigs,
  type Db,
} from "@pal/db";
import {
  PAL_ACHIEVEMENT_KEYS,
  resolvePalAchievementPresentation,
} from "@codepet/pal-widget/achievement-presentation";
import type { IncomingEvent } from "@pal/engine";
import {
  BEHAVIOR_TITLES,
  grantBehaviorTitle,
  grantStoryChapterForPeriod,
} from "@/lib/reward-grants";
import {
  hasValidStoryWeekPosition,
  isCompatibleCalendarRevision,
  isCompatibleTermRevision,
  periodCalendarFromMetadata,
  termCalendarMetadata,
  type PeriodCalendar,
} from "@/lib/achievement-calendar";

export const ACHIEVEMENT_KEYS = PAL_ACHIEVEMENT_KEYS;
export const ACHIEVEMENT_NOTICE_KEY = "achievement-earned-v1";

const FIRST_WEEKLY_CONFIGURATION_FACT =
  "internal.daily_log_week.first_configuration";
const DAILY_LOG_PENDING_FACT = "internal.daily_log.reward_pending";
const DAILY_LOG_SETTLEMENT_FACT = "internal.daily_log.reward_settlement";
const MAX_DAILY_LOG_DAYS_PER_PERIOD = 5;
const MAX_DAILY_LOG_FACTS_PER_PERIOD = MAX_DAILY_LOG_DAYS_PER_PERIOD * 2;

type AchievementStatus = "earned" | "in-progress" | "incomplete";

async function queueAchievementCelebration(
  db: Db,
  input: {
    learnerId: string;
    achievementInstanceId: string;
    achievementKey: string;
  },
): Promise<void> {
  const presentation = resolvePalAchievementPresentation(input.achievementKey);
  if (!presentation) {
    throw new Error(`Unknown achievement presentation: ${input.achievementKey}`);
  }
  await db
    .insert(rewardNotices)
    .values({
      learnerId: input.learnerId,
      achievementInstanceId: input.achievementInstanceId,
      rewardKey: ACHIEVEMENT_NOTICE_KEY,
      // These legacy columns remain required by the current schema. Snapshot
      // projection deliberately resolves the canonical presentation by key.
      title: presentation.title,
      description: presentation.description,
      icon: presentation.badge.icon,
    })
    .onConflictDoNothing();
}

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
  | "invalid_term_story_schedule"
  | "inconsistent_activity_day"
  | "daily_log_period_limit_exceeded";

async function firstConfigurationCalendar(
  db: Db,
  learnerId: string,
  periodKey: string,
): Promise<PeriodCalendar> {
  const [marker] = await db
    .select({
      sourceEventId: learnerFacts.sourceEventId,
      metadata: learnerFacts.metadata,
    })
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
    const [configuration] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          eq(learnerFacts.periodKey, periodKey),
          eq(learnerFacts.sourceEventId, marker.sourceEventId),
        ),
      )
      .limit(1);
    const markerCalendar = periodCalendarFromMetadata(
      (configuration?.metadata ?? marker.metadata) as Record<string, unknown>,
    );
    if (markerCalendar.startDay !== null) return markerCalendar;

    // A period can predate the term-calendar rollout. In that case the first
    // weekly configuration remains the reward-policy authority, while the
    // first later calendar-bearing fact becomes the immutable date window.
    const [firstCalendarConfiguration] = await db
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
      .orderBy(sql`(${learnerFacts.metadata}->>'config_version')::int asc`)
      .limit(1);
    return firstCalendarConfiguration
      ? periodCalendarFromMetadata(
          firstCalendarConfiguration.metadata as Record<string, unknown>,
        )
      : markerCalendar;
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
  return periodCalendarFromMetadata(
    configuration?.metadata as Record<string, unknown> | undefined,
  );
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
  calendar: PeriodCalendar,
): DailyLogFactRow[] {
  return facts.filter((fact) => {
    const activityDay = (fact.metadata as Record<string, unknown>).activity_day;
    if (typeof activityDay !== "string") return false;
    if (
      calendar.timeZone &&
      calendarDayInTimeZone(fact.occurredAt, calendar.timeZone) !== activityDay
    ) {
      return false;
    }
    if (calendar.startDay && activityDay < calendar.startDay) return false;
    if (calendar.endDay && activityDay > calendar.endDay) return false;
    return true;
  });
}

async function validCompletionFacts(
  db: Db,
  learnerId: string,
  periodKey: string,
  firstCalendarOverride?: PeriodCalendar,
): Promise<DailyLogFactRow[]> {
  const calendar =
    firstCalendarOverride ??
    (await firstConfigurationCalendar(db, learnerId, periodKey));
  return calendarValidDailyLogFacts(
    await boundedDailyLogFacts(db, learnerId, periodKey),
    calendar,
  );
}

async function completionCounts(
  db: Db,
  learnerId: string,
  periodKey: string,
  firstCalendarOverride?: PeriodCalendar,
): Promise<{ settled: number; valid: number }> {
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
    firstCalendarOverride,
  );
  if (!firstConfigurationMarker || facts.length === 0) {
    return { settled: facts.length, valid: facts.length };
  }
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
  return { settled: settlementMarkers.length, valid: facts.length };
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
  if (calendar) {
    const totalWeeks = calendar.term_week_count ?? 16;
    if (
      totalWeeks < 6 ||
      totalWeeks > 24 ||
      calendar.week_index < 1 ||
      calendar.week_index > totalWeeks ||
      !hasValidStoryWeekPosition(calendar)
    ) {
      return "invalid_term_story_schedule";
    }
  }
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
  const existingCalendar = existing
    ? await firstConfigurationCalendar(db, learnerId, periodKey)
    : undefined;
  const firstConfigurationCalendarOverride =
    !existing || (existingCalendar?.startDay === null && calendar)
      ? periodCalendarFromMetadata(calendar)
      : undefined;
  if (
    periodStatus === "closed" &&
    eligibleDays <
      (await validCompletionFacts(
        db,
        learnerId,
        periodKey,
        firstConfigurationCalendarOverride,
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
    .select({
      id: weeklyRhythmConfigs.id,
      eligibleDays: weeklyRhythmConfigs.eligibleDays,
    })
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

  const calendar = await firstConfigurationCalendar(db, learnerId, periodKey);
  const activityDay = metadataString(event, "activity_day");
  if (
    (calendar.timeZone &&
      activityDay !==
        calendarDayInTimeZone(new Date(event.occurred_at), calendar.timeZone)) ||
    (calendar.startDay && activityDay < calendar.startDay) ||
    (calendar.endDay && activityDay > calendar.endDay)
  ) {
    return "invalid";
  }
  const qualifyingFacts = calendarValidDailyLogFacts(
    existingFacts,
    calendar,
  );
  if (
    qualifyingFacts.length >= MAX_DAILY_LOG_DAYS_PER_PERIOD ||
    existingFacts.length >= MAX_DAILY_LOG_FACTS_PER_PERIOD
  ) {
    return "period-limit-exceeded";
  }

  // A valid source fact beyond the producer's current allowance is durable but
  // reward-pending. A later higher configuration may release it; paying it now
  // would make eligible_days advisory and could strand a closed correction.
  const counts = await completionCounts(db, learnerId, periodKey);
  return counts.settled >= configuration.eligibleDays ? "pending" : "valid";
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
  const calendar = await firstConfigurationCalendar(db, learnerId, periodKey);
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

  const candidates = calendarValidDailyLogFacts(boundedFacts, calendar)
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
  if (created) {
    if (input.status === "earned") {
      await queueAchievementCelebration(db, {
        learnerId: input.learnerId,
        achievementInstanceId: created.id,
        achievementKey: input.achievementKey,
      });
    }
    return { id: created.id, created: true };
  }

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

  const completion = await completionCounts(db, learnerId, periodKey);
  const current = completion.settled;
  const targetDays = weeklyTarget(configuration.eligibleDays);
  const reconciliationRequired = completion.valid > configuration.eligibleDays;
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
    if (status === "earned") {
      await queueAchievementCelebration(db, {
        learnerId,
        achievementInstanceId: existing.id,
        achievementKey: ACHIEVEMENT_KEYS.weeklyRhythm,
      });
      await grantStoryChapterForPeriod(db, { learnerId, periodKey, sourceFactId: factId });
    }
    return status === "earned";
  }

  const [created] = await db
    .insert(achievementInstances)
    .values({
      learnerId,
      achievementKey: ACHIEVEMENT_KEYS.weeklyRhythm,
      scopeKey: periodKey,
      periodKey,
      status,
      progressCurrent: displayCurrent,
      progressTarget: displayTarget,
      earnedAt: status === "earned" ? occurredAt : null,
      sourceFactId: factId,
    })
    .returning({ id: achievementInstances.id });
  if (!created) throw new Error("Failed to create Weekly Rhythm achievement");
  if (status === "earned") {
    await queueAchievementCelebration(db, {
      learnerId,
      achievementInstanceId: created.id,
      achievementKey: ACHIEVEMENT_KEYS.weeklyRhythm,
    });
    await grantStoryChapterForPeriod(db, { learnerId, periodKey, sourceFactId: factId });
  }
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
        await grantBehaviorTitle(db, {
          learnerId,
          titleId: BEHAVIOR_TITLES.onTimePro.id,
          sourceFactId: fact.id,
        });
      }
      return {};
    }
  }
  return {};
}
