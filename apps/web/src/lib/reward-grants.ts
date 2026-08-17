import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
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

function storySketchRewardsEffectiveAt(): Date | undefined {
  const raw = process.env.PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT?.trim();
  if (!raw) return undefined;
  const effectiveAt = new Date(raw);
  if (Number.isNaN(effectiveAt.getTime())) {
    throw new Error("PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT must be an ISO timestamp");
  }
  return effectiveAt;
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
 * Guarantees the story without manufacturing achievement credit. Each accepted
 * learner event reconciles every feature-eligible chapter whose following week
 * has started. Closing the final week additionally grants that week's chapter.
 * Weekly Rhythm may have granted an assignment earlier, and the ownership
 * constraint makes reconciliation idempotent.
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
  const effectiveAt = storySketchRewardsEffectiveAt();
  if (!effectiveAt) return;
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
  if (
    input.event.event_type === "daily_log_week.configured" &&
    !input.configurationAdvances &&
    !finalPeriodClosed
  ) return;

  const assignments = await db
    .select({
      periodKey: storyPlanChapters.periodKey,
      storyPlanId: storyPlanChapters.storyPlanId,
      storyPlanChapterId: storyPlanChapters.id,
      periodNumber: storyPlanChapters.periodNumber,
    })
    .from(storyPlanChapters)
    .where(and(
      eq(storyPlanChapters.learnerId, input.learnerId),
      eq(storyPlanChapters.storyPlanId, currentAssignment.storyPlanId),
      lte(storyPlanChapters.periodNumber, currentAssignment.periodNumber),
      isNotNull(storyPlanChapters.periodKey),
    ))
    .orderBy(asc(storyPlanChapters.periodNumber));
  const assignmentPeriodKeys = assignments.flatMap((assignment) =>
    assignment.periodKey ? [assignment.periodKey] : []
  );
  if (assignmentPeriodKeys.length === 0) return;
  const configurations = await db
    .select({
      id: learnerFacts.id,
      periodKey: learnerFacts.periodKey,
      metadata: learnerFacts.metadata,
    })
    .from(learnerFacts)
    .where(and(
      eq(learnerFacts.learnerId, input.learnerId),
      eq(learnerFacts.eventType, "daily_log_week.configured"),
      inArray(learnerFacts.periodKey, assignmentPeriodKeys),
      gte(learnerFacts.createdAt, effectiveAt),
      sql`${learnerFacts.metadata} ? 'term_timezone'`,
    ))
    .orderBy(asc(learnerFacts.createdAt));
  const firstEligibleConfiguration = new Map<
    string,
    { id: string; metadata: Record<string, unknown> }
  >();
  for (const configuration of configurations) {
    if (
      !configuration.periodKey ||
      firstEligibleConfiguration.has(configuration.periodKey) ||
      !configuration.metadata ||
      typeof configuration.metadata !== "object" ||
      Array.isArray(configuration.metadata)
    ) continue;
    firstEligibleConfiguration.set(configuration.periodKey, {
      id: configuration.id,
      metadata: configuration.metadata as Record<string, unknown>,
    });
  }

  const eventTime = new Date(input.event.occurred_at);
  for (let index = 0; index < assignments.length - 1; index += 1) {
    const assignment = assignments[index]!;
    const boundaryAssignment = assignments[index + 1]!;
    if (boundaryAssignment.periodNumber !== assignment.periodNumber + 1) continue;
    const sourceConfiguration = firstEligibleConfiguration.get(assignment.periodKey!);
    const boundaryConfiguration = firstEligibleConfiguration.get(boundaryAssignment.periodKey!);
    if (
      !sourceConfiguration ||
      !boundaryConfiguration ||
      !configuredWeekHasStarted(boundaryConfiguration.metadata, eventTime)
    ) continue;
    await insertStoryChapterGrant(db, {
      learnerId: input.learnerId,
      sourceFactId: sourceConfiguration.id,
      storyPlanId: assignment.storyPlanId,
      storyPlanChapterId: assignment.storyPlanChapterId,
    });
  }

  if (finalPeriodClosed && firstEligibleConfiguration.has(periodKey)) {
    await insertStoryChapterGrant(db, {
      learnerId: input.learnerId,
      sourceFactId: input.sourceFactId,
      storyPlanId: currentAssignment.storyPlanId,
      storyPlanChapterId: currentAssignment.storyPlanChapterId,
    });
  }
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
