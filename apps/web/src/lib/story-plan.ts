import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { learnerFacts, storyPlanChapters, storyPlans, type Db } from "@pal/db";
import type { IncomingEvent } from "@pal/engine";
import {
  STORY_REGISTRY,
  storyForTermStartDay,
  type PlannedStoryChapter,
  type StoryReference,
} from "@/lib/story-catalog";

type TermPeriod = {
  termKey: string;
  termStartDay: string;
  totalPeriods: number;
  periodKey: string;
  periodNumber: number;
};

export interface PersistedStoryChapter extends PlannedStoryChapter {
  assignmentId: string;
  periodKey: string | null;
}

export interface PersistedStoryPlan extends StoryReference {
  id: string;
  learnerId: string;
  termKey: string;
  termStartDay: string;
  totalPeriods: number;
  companionCollectibleId: string;
  mysteryCollectibleId: string;
  chapters: readonly PersistedStoryChapter[];
}

type StoryPlanRow = typeof storyPlans.$inferSelect;
type StoryPlanChapterRow = typeof storyPlanChapters.$inferSelect;

export function storyPlanPeriodCountMatchesTerm(
  persistedPeriods: number,
  termPeriods: number,
  catalogPeriods: number,
): boolean {
  return persistedPeriods === termPeriods || persistedPeriods === catalogPeriods;
}

function termPeriodFromMetadata(metadata: Record<string, unknown>): TermPeriod | null {
  if (
    typeof metadata.term_token !== "string" ||
    typeof metadata.term_start_day !== "string" ||
    typeof metadata.period_key !== "string" ||
    !Number.isInteger(metadata.week_index)
  ) {
    return null;
  }
  return {
    termKey: metadata.term_token,
    termStartDay: metadata.term_start_day,
    totalPeriods: Number.isInteger(metadata.term_week_count)
      ? (metadata.term_week_count as number)
      : 16,
    periodKey: metadata.period_key,
    periodNumber: metadata.week_index as number,
  };
}

async function termPeriodForEvent(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<TermPeriod | null> {
  if (event.event_type === "daily_log_week.configured") {
    return termPeriodFromMetadata(event.metadata);
  }
  const periodKey = event.metadata.period_key;
  if (typeof periodKey !== "string") return null;
  const [calendarFact] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, periodKey),
        sql`${learnerFacts.metadata} ? 'term_token'`,
      ),
    )
    .orderBy(
      sql`(${learnerFacts.metadata} ? 'term_week_count') desc`,
      sql`(${learnerFacts.metadata}->>'config_version')::int desc`,
    )
    .limit(1);
  return calendarFact
    ? termPeriodFromMetadata(calendarFact.metadata as Record<string, unknown>)
    : null;
}

async function resolveStoryPlanRow(db: Db, learnerId: string, termKey: string) {
  const [plan] = await db
    .select()
    .from(storyPlans)
    .where(and(eq(storyPlans.learnerId, learnerId), eq(storyPlans.termKey, termKey)))
    .limit(1);
  return plan;
}

function materializePersistedStoryPlan(
  plan: StoryPlanRow,
  rows: readonly StoryPlanChapterRow[],
): PersistedStoryPlan {
  const reference = { storyId: plan.storyId, version: plan.storyVersion };
  const catalog = STORY_REGISTRY.requireCatalog(reference);
  if (
    rows.length !== plan.totalPeriods ||
    rows.some((row, index) => row.periodNumber !== index + 1)
  ) {
    throw new Error("Persisted story plan is incomplete");
  }
  return {
    id: plan.id,
    learnerId: plan.learnerId,
    termKey: plan.termKey,
    termStartDay: plan.termStartDay,
    storyId: plan.storyId,
    version: plan.storyVersion,
    totalPeriods: plan.totalPeriods,
    companionCollectibleId: catalog.companionCollectibleId,
    mysteryCollectibleId: catalog.mysteryCollectibleId,
    chapters: rows.map((row) => {
      const chapter = catalog.resolveChapter(row.chapterId);
      if (!chapter) throw new Error(`Unknown persisted story chapter: ${row.chapterId}`);
      return {
        ...chapter,
        assignmentId: row.id,
        periodKey: row.periodKey,
        roadmapWeek: row.periodNumber,
        sourceChapterIds: [row.chapterId],
      };
    }),
  };
}

/** The caller owns the learner row lock and surrounding transaction. */
export async function ensureStoryPlanForEvent(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<void> {
  const termPeriod = await termPeriodForEvent(db, learnerId, event);
  if (!termPeriod) return;
  let plan = await resolveStoryPlanRow(db, learnerId, termPeriod.termKey);
  if (!plan) {
    const reference = storyForTermStartDay(termPeriod.termStartDay);
    const generated = STORY_REGISTRY.createPlan(termPeriod.totalPeriods, reference);
    const [created] = await db
      .insert(storyPlans)
      .values({
        learnerId,
        termKey: termPeriod.termKey,
        termStartDay: termPeriod.termStartDay,
        storyId: generated.storyId,
        storyVersion: generated.version,
        totalPeriods: generated.totalPeriods,
      })
      .onConflictDoNothing()
      .returning();
    plan = created ?? (await resolveStoryPlanRow(db, learnerId, termPeriod.termKey));
    if (!plan) throw new Error("Failed to create or resolve the learner story plan");
    if (created) {
      await db.insert(storyPlanChapters).values(
        generated.chapters.map((chapter) => ({
          storyPlanId: created.id,
          learnerId,
          periodNumber: chapter.roadmapWeek,
          chapterId: chapter.id,
        })),
      );
    }
  }
  const pinnedReference = { storyId: plan.storyId, version: plan.storyVersion };
  const pinnedCatalog = STORY_REGISTRY.getCatalog(pinnedReference);
  const expectedStoryPeriods = pinnedCatalog
    ?.createPlan(termPeriod.totalPeriods).totalPeriods;
  if (
    plan.termStartDay !== termPeriod.termStartDay ||
    !pinnedCatalog ||
    expectedStoryPeriods === undefined ||
    !storyPlanPeriodCountMatchesTerm(
      plan.totalPeriods,
      termPeriod.totalPeriods,
      expectedStoryPeriods,
    )
  ) {
    throw new Error("Configured term does not match its persisted story plan");
  }
  // A story may intentionally finish before its academic term. Those later
  // periods have no chapter to bind, but their normal events remain valid.
  if (termPeriod.periodNumber > plan.totalPeriods) return;
  const [assignment] = await db
    .select()
    .from(storyPlanChapters)
    .where(
      and(
        eq(storyPlanChapters.storyPlanId, plan.id),
        eq(storyPlanChapters.periodNumber, termPeriod.periodNumber),
      ),
    )
    .limit(1);
  if (!assignment) throw new Error("Story plan is missing its configured period");
  if (assignment.periodKey && assignment.periodKey !== termPeriod.periodKey) {
    throw new Error("Story period is already bound to another opaque period");
  }
  if (!assignment.periodKey) {
    await db
      .update(storyPlanChapters)
      .set({ periodKey: termPeriod.periodKey, updatedAt: new Date() })
      .where(eq(storyPlanChapters.id, assignment.id));
  }
}

/** Loads the exact persisted order. Catalog defaults are never consulted. */
export async function loadPersistedStoryPlan(
  db: Db,
  learnerId: string,
  termKey: string,
): Promise<PersistedStoryPlan | undefined> {
  const plan = await resolveStoryPlanRow(db, learnerId, termKey);
  if (!plan) return undefined;
  const rows = await db
    .select()
    .from(storyPlanChapters)
    .where(
      and(
        eq(storyPlanChapters.storyPlanId, plan.id),
        eq(storyPlanChapters.learnerId, learnerId),
      ),
    )
    .orderBy(asc(storyPlanChapters.periodNumber));
  return materializePersistedStoryPlan(plan, rows);
}

/** Resolves durable story grants through their exact learner-owned pinned plans. */
export async function loadPersistedStoryPlansByIds(
  db: Db,
  learnerId: string,
  planIds: readonly string[],
): Promise<ReadonlyMap<string, PersistedStoryPlan>> {
  const uniqueIds = [...new Set(planIds)];
  if (uniqueIds.length === 0) return new Map();
  const plans = await db
    .select()
    .from(storyPlans)
    .where(
      and(
        eq(storyPlans.learnerId, learnerId),
        inArray(storyPlans.id, uniqueIds),
      ),
    );
  if (plans.length === 0) return new Map();
  const rows = await db
    .select()
    .from(storyPlanChapters)
    .where(
      and(
        eq(storyPlanChapters.learnerId, learnerId),
        inArray(storyPlanChapters.storyPlanId, plans.map((plan) => plan.id)),
      ),
    )
    .orderBy(
      asc(storyPlanChapters.storyPlanId),
      asc(storyPlanChapters.periodNumber),
    );
  return new Map(
    plans.map((plan) => [
      plan.id,
      materializePersistedStoryPlan(
        plan,
        rows.filter((row) => row.storyPlanId === plan.id),
      ),
    ]),
  );
}
