import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  learnerFacts,
  learnerRewardGrants,
  storyPlanChapters,
  storyPlans,
  type Db,
} from "@pal/db";
import type { IncomingEvent } from "@pal/engine";

export const BEHAVIOR_TITLES = Object.freeze({
  rhythmBuilder: Object.freeze({ id: "rhythm-builder", label: "Rhythm Builder", description: "Show up three days in a row.", revealCopy: "A steady rhythm becomes a strength you can keep." }),
  onTimePro: Object.freeze({ id: "on-time-pro", label: "On-Time Pro", description: "Earn an On-Time Finish badge.", revealCopy: "You finished when it counted." }),
  levelLeader: Object.freeze({ id: "level-leader", label: "Level Leader", description: "Reach companion Level 5.", revealCopy: "Your consistent learning helped your companion grow." }),
} as const);

export type BehaviorTitleId = (typeof BEHAVIOR_TITLES)[keyof typeof BEHAVIOR_TITLES]["id"];
const behaviorById = new Map(Object.values(BEHAVIOR_TITLES).map((title) => [title.id, title]));

export function resolveBehaviorTitle(titleId: string) {
  return behaviorById.get(titleId as BehaviorTitleId);
}

export async function grantBehaviorTitle(
  db: Db,
  input: { learnerId: string; titleId: BehaviorTitleId; sourceFactId: string },
): Promise<void> {
  await db.insert(learnerRewardGrants).values({
    learnerId: input.learnerId,
    kind: "behavior_title",
    sourceFactId: input.sourceFactId,
    behaviorTitleId: input.titleId,
  }).onConflictDoNothing();
}

export async function grantStoryChapterForPeriod(
  db: Db,
  input: { learnerId: string; periodKey: string; sourceFactId: string },
): Promise<void> {
  const [assignment] = await db
    .select({ storyPlanId: storyPlans.id, storyPlanChapterId: storyPlanChapters.id })
    .from(storyPlanChapters)
    .innerJoin(storyPlans, and(
      eq(storyPlans.id, storyPlanChapters.storyPlanId),
      eq(storyPlans.learnerId, storyPlanChapters.learnerId),
    ))
    .where(and(
      eq(storyPlanChapters.learnerId, input.learnerId),
      eq(storyPlanChapters.periodKey, input.periodKey),
    ))
    .limit(1);
  if (!assignment) return;
  await db.insert(learnerRewardGrants).values({
    learnerId: input.learnerId,
    kind: "story_chapter",
    sourceFactId: input.sourceFactId,
    storyPlanId: assignment.storyPlanId,
    storyPlanChapterId: assignment.storyPlanChapterId,
  }).onConflictDoNothing();
}

/**
 * Guarantees the story without manufacturing achievement credit. A started
 * configured week—or its first later accepted learner event—grants the
 * immediately preceding bound chapter as a sketch; closing the final week
 * grants that week's chapter. Weekly Rhythm may have granted the same
 * assignment earlier, and the ownership constraint makes reconciliation
 * idempotent.
 */
export async function grantStoryChapterForScheduleAdvance(
  db: Db,
  input: {
    learnerId: string;
    sourceFactId: string;
    event: IncomingEvent;
    configurationAdvances: boolean;
  },
): Promise<void> {
  const periodKey = input.event.metadata.period_key;
  if (typeof periodKey !== "string") return;
  const [currentAssignment] = await db
    .select({
      periodKey: storyPlanChapters.periodKey,
      storyPlanId: storyPlans.id,
      storyPlanChapterId: storyPlanChapters.id,
      periodNumber: storyPlanChapters.periodNumber,
      totalPeriods: storyPlans.totalPeriods,
    })
    .from(storyPlanChapters)
    .innerJoin(storyPlans, and(
      eq(storyPlans.id, storyPlanChapters.storyPlanId),
      eq(storyPlans.learnerId, storyPlanChapters.learnerId),
    ))
    .where(and(
      eq(storyPlanChapters.learnerId, input.learnerId),
      eq(storyPlanChapters.periodKey, periodKey),
    ))
    .limit(1);
  if (!currentAssignment) return;

  const finalPeriodClosed =
    input.event.event_type === "daily_log_week.configured" &&
    input.configurationAdvances &&
    input.event.metadata.period_status === "closed" &&
    currentAssignment.periodNumber === currentAssignment.totalPeriods;
  if (finalPeriodClosed) {
    await insertStoryChapterGrant(db, {
      learnerId: input.learnerId,
      sourceFactId: input.sourceFactId,
      storyPlanId: currentAssignment.storyPlanId,
      storyPlanChapterId: currentAssignment.storyPlanChapterId,
    });
    return;
  }
  if (
    input.event.event_type === "daily_log_week.configured" &&
    !input.configurationAdvances
  ) return;
  if (currentAssignment.periodNumber <= 1) return;

  const [currentPeriodConfiguration] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(and(
      eq(learnerFacts.learnerId, input.learnerId),
      eq(learnerFacts.eventType, "daily_log_week.configured"),
      eq(learnerFacts.periodKey, periodKey),
      sql`${learnerFacts.metadata} ? 'term_timezone'`,
    ))
    .orderBy(sql`(${learnerFacts.metadata}->>'config_version')::int asc`)
    .limit(1);
  const currentPeriodMetadata = currentPeriodConfiguration?.metadata;
  if (
    !currentPeriodMetadata ||
    typeof currentPeriodMetadata !== "object" ||
    Array.isArray(currentPeriodMetadata) ||
    !configuredWeekHasStarted(
      currentPeriodMetadata as Record<string, unknown>,
      new Date(input.event.occurred_at),
    )
  ) return;

  const [priorAssignment] = await db
    .select({
      periodKey: storyPlanChapters.periodKey,
      storyPlanId: storyPlanChapters.storyPlanId,
      storyPlanChapterId: storyPlanChapters.id,
    })
    .from(storyPlanChapters)
    .where(and(
      eq(storyPlanChapters.learnerId, input.learnerId),
      eq(storyPlanChapters.storyPlanId, currentAssignment.storyPlanId),
      eq(
        storyPlanChapters.periodNumber,
        currentAssignment.periodNumber - 1,
      ),
      isNotNull(storyPlanChapters.periodKey),
    ))
    .limit(1);
  if (!priorAssignment) return;
  const [priorPeriodConfiguration] = await db
      .select({ id: learnerFacts.id })
      .from(learnerFacts)
      .where(and(
        eq(learnerFacts.learnerId, input.learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, priorAssignment.periodKey!),
      ))
      .orderBy(asc(learnerFacts.createdAt))
      .limit(1);
  if (!priorPeriodConfiguration) return;
  await insertStoryChapterGrant(db, {
    learnerId: input.learnerId,
    sourceFactId: priorPeriodConfiguration.id,
    storyPlanId: priorAssignment.storyPlanId,
    storyPlanChapterId: priorAssignment.storyPlanChapterId,
  });
}

async function insertStoryChapterGrant(
  db: Db,
  input: {
    learnerId: string;
    sourceFactId: string;
    storyPlanId: string;
    storyPlanChapterId: string;
  },
): Promise<void> {
  await db.insert(learnerRewardGrants).values({
    learnerId: input.learnerId,
    kind: "story_chapter",
    sourceFactId: input.sourceFactId,
    storyPlanId: input.storyPlanId,
    storyPlanChapterId: input.storyPlanChapterId,
  }).onConflictDoNothing();
}

function configuredWeekHasStarted(
  metadata: Record<string, unknown>,
  occurredAt: Date,
): boolean {
  const weekIndex = metadata.week_index;
  const termStartDay = metadata.term_start_day;
  const timeZone = metadata.term_timezone;
  if (
    typeof weekIndex !== "number" ||
    !Number.isInteger(weekIndex) ||
    weekIndex < 1 ||
    typeof termStartDay !== "string" ||
    typeof timeZone !== "string"
  ) return false;
  const startDay = typeof metadata.week_start_day === "string"
    ? metadata.week_start_day
    : addCalendarDays(
        termStartDay,
        (weekIndex - 1) * 7,
      );
  if (!startDay) return false;
  return calendarDayInTimeZone(
    occurredAt,
    timeZone,
  ) >= startDay;
}

function addCalendarDays(day: string, count: number): string | undefined {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
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
