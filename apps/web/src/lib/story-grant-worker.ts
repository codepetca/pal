import { and, asc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  getDb,
  learnerFacts,
  learnerRewardGrants,
  learners,
  storyPlanChapters,
  type Db,
} from "@pal/db";
import {
  reconcileDueStoryGrants,
  type StoryGrantReconciliationResult,
} from "@/lib/story-grant-reconciler";
import { STORY_SKETCH_REWARDS_EFFECTIVE_AT } from "@/lib/story-sketch-rollout";

export const STORY_GRANT_BATCH_SIZE = 25;
export const STORY_GRANT_MAX_BATCHES = 20;
export const STORY_GRANT_CONCURRENCY = 5;

export type StoryGrantWorkerResult = {
  batches: number;
  learners: number;
  failedLearners: number;
  grants: number;
  batchLimitReached: boolean;
};

const weekStartDay = sql`coalesce(
  nullif(${learnerFacts.metadata}->>'week_start_day', '')::date,
  (${learnerFacts.metadata}->>'term_start_day')::date
    + ((((${learnerFacts.metadata}->>'week_index')::int) - 1) * 7)
)`;
const friday = sql`(${weekStartDay}
  + (5 - extract(isodow from ${weekStartDay})::int))`;
const dueDay = sql`(least(
  ${friday},
  (${learnerFacts.metadata}->>'term_end_day')::date
) + 1)`;

/** Returns one bounded, stable page of learners with at least one overdue slot. */
export async function findLearnersWithDueStoryGrants(
  db: Db,
  input: {
    asOf: Date;
    rolloutEffectiveAt: Date;
    afterLearnerId?: string;
    onlyLearnerIds?: readonly string[];
    limit: number;
  },
): Promise<string[]> {
  if (input.onlyLearnerIds?.length === 0) return [];
  const rows = await db
    .selectDistinct({ learnerId: storyPlanChapters.learnerId })
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
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        gte(learnerFacts.createdAt, input.rolloutEffectiveAt),
        sql`${learnerFacts.metadata} ?& array[
          'term_start_day',
          'term_end_day',
          'term_timezone',
          'week_index'
        ]`,
        sql`extract(isodow from ${weekStartDay}) between 1 and 5`,
        sql`(${input.asOf} at time zone (${learnerFacts.metadata}->>'term_timezone'))::date >= ${dueDay}`,
        sql`${dueDay}::timestamp at time zone (${learnerFacts.metadata}->>'term_timezone') >= ${input.rolloutEffectiveAt}`,
        isNull(learnerRewardGrants.id),
        ...(input.onlyLearnerIds
          ? [inArray(storyPlanChapters.learnerId, input.onlyLearnerIds)]
          : []),
        ...(input.afterLearnerId
          ? [gt(storyPlanChapters.learnerId, input.afterLearnerId)]
          : []),
      ),
    )
    .orderBy(asc(storyPlanChapters.learnerId))
    .limit(input.limit);
  return rows.map((row) => row.learnerId);
}

/** Serializes one scheduled reconciliation with every other learner write. */
export async function reconcileDueStoryGrantsForLearner(
  learnerId: string,
  input: {
    asOf: Date;
    rolloutEffectiveAt: Date;
    db?: Db;
  },
): Promise<StoryGrantReconciliationResult> {
  const db = input.db ?? getDb();
  return db.transaction(async (tx) => {
    const [learner] = await tx
      .select({ id: learners.id })
      .from(learners)
      .where(eq(learners.id, learnerId))
      .limit(1);
    if (!learner) return { candidates: 0, due: 0, granted: 0 };
    await tx.execute(
      sql`SELECT id FROM ${learners} WHERE id = ${learnerId} FOR UPDATE`,
    );
    return reconcileDueStoryGrants(tx, {
      learnerId,
      asOf: input.asOf,
      rolloutEffectiveAt: input.rolloutEffectiveAt,
    });
  });
}

export async function runStoryGrantWorker(
  options: {
    asOf?: Date;
    rolloutEffectiveAt?: Date;
    batchSize?: number;
    maxBatches?: number;
    concurrency?: number;
    // Deterministic integration-test seam; production always leaves this unset.
    onlyLearnerIds?: readonly string[];
    db?: Db;
  } = {},
): Promise<StoryGrantWorkerResult> {
  const effectiveAt = options.rolloutEffectiveAt ??
    STORY_SKETCH_REWARDS_EFFECTIVE_AT;
  if (!effectiveAt) {
    throw new Error("PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT is required");
  }
  const db = options.db ?? getDb();
  const asOf = options.asOf ?? new Date();
  const batchSize = Math.max(
    1,
    Math.min(options.batchSize ?? STORY_GRANT_BATCH_SIZE, 100),
  );
  const maxBatches = Math.max(
    1,
    Math.min(options.maxBatches ?? STORY_GRANT_MAX_BATCHES, 100),
  );
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? STORY_GRANT_CONCURRENCY, batchSize),
  );
  let batches = 0;
  let learnersProcessed = 0;
  let failedLearners = 0;
  let grants = 0;
  let afterLearnerId: string | undefined;
  let lastBatchWasFull = false;

  while (batches < maxBatches) {
    const learnerIds = await findLearnersWithDueStoryGrants(db, {
      asOf,
      rolloutEffectiveAt: effectiveAt,
      afterLearnerId,
      onlyLearnerIds: options.onlyLearnerIds,
      limit: batchSize,
    });
    if (learnerIds.length === 0) break;
    batches += 1;
    lastBatchWasFull = learnerIds.length === batchSize;
    afterLearnerId = learnerIds.at(-1);

    for (let offset = 0; offset < learnerIds.length; offset += concurrency) {
      const results = await Promise.allSettled(
        learnerIds.slice(offset, offset + concurrency).map((learnerId) =>
          reconcileDueStoryGrantsForLearner(learnerId, {
            asOf,
            rolloutEffectiveAt: effectiveAt,
            db,
          }),
        ),
      );
      for (const result of results) {
        learnersProcessed += 1;
        if (result.status === "fulfilled") {
          grants += result.value.granted;
        } else {
          failedLearners += 1;
          console.error("[pal] scheduled story grant reconciliation failed");
        }
      }
    }
  }

  return {
    batches,
    learners: learnersProcessed,
    failedLearners,
    grants,
    batchLimitReached: batches === maxBatches && lastBatchWasFull,
  };
}
