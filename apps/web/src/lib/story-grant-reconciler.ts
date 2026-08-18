import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import {
  learnerRewardGrants,
  storyCollectibleSchedules,
  storyPlanChapters,
  type Db,
} from "@pal/db";
import { insertStoryChapterGrant } from "@/lib/reward-grants";

export type StoryGrantReconciliationResult = {
  candidates: number;
  due: number;
  granted: number;
  hasMore: boolean;
};

export const STORY_GRANT_RECONCILE_LIMIT = 24;

/**
 * Reconciles one bounded page of overdue post-rollout story assignments for
 * one locked learner. Both event ingest and the scheduled worker call this
 * function; later worker invocations recover any additional pages.
 * It grants ownership only: Weekly Rhythm remains the durable authority for
 * sketch-versus-color presentation, XP, achievements, and activity state.
 *
 * The caller owns the learner row lock and surrounding transaction.
 */
export async function reconcileDueStoryGrants(
  db: Db,
  input: {
    learnerId: string;
    asOf?: Date;
    limit?: number;
  },
): Promise<StoryGrantReconciliationResult> {
  const asOf = input.asOf ?? new Date();
  const limit = Math.max(
    1,
    Math.min(input.limit ?? STORY_GRANT_RECONCILE_LIMIT, 100),
  );

  // The typed schedule is durable due work derived from one stable weekly fact.
  // The reward ledger remains ownership authority; an existing grant is enough
  // to consume queue work left pending by a retry or pre-migration scheduler.
  const discoveredCandidates = await db
    .select({
      scheduleId: storyCollectibleSchedules.id,
      sourceFactId: storyCollectibleSchedules.sourceFactId,
      storyPlanId: storyPlanChapters.storyPlanId,
      storyPlanChapterId: storyPlanChapters.id,
      existingGrantId: learnerRewardGrants.id,
    })
    .from(storyCollectibleSchedules)
    .innerJoin(
      storyPlanChapters,
      and(
        eq(
          storyCollectibleSchedules.learnerId,
          storyPlanChapters.learnerId,
        ),
        eq(
          storyCollectibleSchedules.periodKey,
          storyPlanChapters.periodKey,
        ),
      ),
    )
    .leftJoin(
      learnerRewardGrants,
      and(
        eq(
          learnerRewardGrants.storyPlanChapterId,
          storyPlanChapters.id,
        ),
        eq(learnerRewardGrants.kind, "story_chapter"),
      ),
    )
    .where(
      and(
        eq(storyCollectibleSchedules.learnerId, input.learnerId),
        isNull(storyCollectibleSchedules.reconciledAt),
        lte(storyCollectibleSchedules.dueAt, asOf),
      ),
    )
    .orderBy(
      asc(storyCollectibleSchedules.dueAt),
      asc(storyCollectibleSchedules.id),
    )
    .limit(limit + 1);

  const hasMore = discoveredCandidates.length > limit;
  const candidates = discoveredCandidates.slice(0, limit);

  let granted = 0;
  for (const candidate of candidates) {
    if (!candidate.existingGrantId) {
      if (await insertStoryChapterGrant(db, {
        learnerId: input.learnerId,
        sourceFactId: candidate.sourceFactId,
        storyPlanId: candidate.storyPlanId,
        storyPlanChapterId: candidate.storyPlanChapterId,
      })) {
        granted += 1;
      }
    }
    await db
      .update(storyCollectibleSchedules)
      .set({ reconciledAt: sql`now()` })
      .where(
        and(
          eq(storyCollectibleSchedules.id, candidate.scheduleId),
          isNull(storyCollectibleSchedules.reconciledAt),
        ),
      );
  }
  return {
    candidates: candidates.length,
    due: candidates.length,
    granted,
    hasMore,
  };
}
