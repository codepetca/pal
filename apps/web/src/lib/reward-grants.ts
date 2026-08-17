import { and, asc, eq, isNotNull } from "drizzle-orm";
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
 * Guarantees the story without manufacturing achievement credit. Opening a new
 * configured week grants the immediately preceding bound chapter as a sketch;
 * closing the final week grants that week's chapter. Weekly Rhythm may have
 * granted the same assignment earlier, and the ownership constraint makes this
 * schedule fallback idempotent.
 */
export async function grantStoryChapterForScheduleAdvance(
  db: Db,
  input: { learnerId: string; sourceFactId: string; event: IncomingEvent },
): Promise<void> {
  if (input.event.event_type !== "daily_log_week.configured") return;
  const termKey = input.event.metadata.term_token;
  const weekIndex = input.event.metadata.week_index;
  const periodStatus = input.event.metadata.period_status;
  if (
    typeof termKey !== "string" ||
    !Number.isInteger(weekIndex) ||
    (weekIndex as number) < 1
  ) return;
  const targetPeriod = periodStatus === "closed"
    ? (weekIndex as number)
    : (weekIndex as number) - 1;
  if (targetPeriod < 1) return;

  const [assignment] = await db
    .select({
      periodKey: storyPlanChapters.periodKey,
      storyPlanId: storyPlans.id,
      storyPlanChapterId: storyPlanChapters.id,
    })
    .from(storyPlanChapters)
    .innerJoin(storyPlans, and(
      eq(storyPlans.id, storyPlanChapters.storyPlanId),
      eq(storyPlans.learnerId, storyPlanChapters.learnerId),
    ))
    .where(and(
      eq(storyPlans.learnerId, input.learnerId),
      eq(storyPlans.termKey, termKey),
      eq(storyPlanChapters.periodNumber, targetPeriod),
      isNotNull(storyPlanChapters.periodKey),
    ))
    .limit(1);
  if (!assignment) return;
  let sourceFactId = input.sourceFactId;
  if (periodStatus !== "closed") {
    const [periodConfiguration] = await db
      .select({ id: learnerFacts.id })
      .from(learnerFacts)
      .where(and(
        eq(learnerFacts.learnerId, input.learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, assignment.periodKey!),
      ))
      .orderBy(asc(learnerFacts.createdAt))
      .limit(1);
    if (!periodConfiguration) return;
    sourceFactId = periodConfiguration.id;
  }
  await db.insert(learnerRewardGrants).values({
    learnerId: input.learnerId,
    kind: "story_chapter",
    sourceFactId,
    storyPlanId: assignment.storyPlanId,
    storyPlanChapterId: assignment.storyPlanChapterId,
  }).onConflictDoNothing();
}
