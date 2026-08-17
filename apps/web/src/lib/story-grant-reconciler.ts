import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  learnerFacts,
  learnerRewardGrants,
  storyPlanChapters,
  type Db,
} from "@pal/db";
import { insertStoryChapterGrant } from "@/lib/reward-grants";
import { isStoryCollectibleDue } from "@/lib/story-grant-calendar";
import { STORY_SKETCH_REWARDS_EFFECTIVE_AT } from "@/lib/story-sketch-rollout";

export type StoryGrantReconciliationResult = {
  candidates: number;
  due: number;
  granted: number;
};

/**
 * Reconciles every overdue post-rollout story assignment for one locked
 * learner. Both event ingest and the scheduled worker call this function.
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
    rolloutEffectiveAt?: Date;
  },
): Promise<StoryGrantReconciliationResult> {
  const effectiveAt = input.rolloutEffectiveAt ??
    STORY_SKETCH_REWARDS_EFFECTIVE_AT;
  if (!effectiveAt) return { candidates: 0, due: 0, granted: 0 };
  const asOf = input.asOf ?? new Date();

  // DISTINCT ON chooses one stable, post-rollout provenance fact per immutable
  // learner-owned story assignment while the reward-ledger join avoids work for
  // chapters already granted by an earlier event or scheduled reconciliation.
  const candidates = await db
    .selectDistinctOn([storyPlanChapters.id], {
      sourceFactId: learnerFacts.id,
      metadata: learnerFacts.metadata,
      storyPlanId: storyPlanChapters.storyPlanId,
      storyPlanChapterId: storyPlanChapters.id,
    })
    .from(storyPlanChapters)
    .innerJoin(
      learnerFacts,
      and(
        eq(learnerFacts.learnerId, storyPlanChapters.learnerId),
        eq(learnerFacts.periodKey, storyPlanChapters.periodKey),
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
        eq(storyPlanChapters.learnerId, input.learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        gte(learnerFacts.createdAt, effectiveAt),
        sql`${learnerFacts.metadata} ? 'term_timezone'`,
        isNull(learnerRewardGrants.id),
      ),
    )
    .orderBy(
      asc(storyPlanChapters.id),
      asc(learnerFacts.createdAt),
      asc(learnerFacts.id),
    );

  let due = 0;
  let granted = 0;
  for (const candidate of candidates) {
    if (
      !candidate.metadata ||
      typeof candidate.metadata !== "object" ||
      Array.isArray(candidate.metadata) ||
      !isStoryCollectibleDue(
        candidate.metadata as Record<string, unknown>,
        asOf,
        effectiveAt,
      )
    ) {
      continue;
    }
    due += 1;
    if (await insertStoryChapterGrant(db, {
      learnerId: input.learnerId,
      sourceFactId: candidate.sourceFactId,
      storyPlanId: candidate.storyPlanId,
      storyPlanChapterId: candidate.storyPlanChapterId,
    })) {
      granted += 1;
    }
  }
  return { candidates: candidates.length, due, granted };
}
