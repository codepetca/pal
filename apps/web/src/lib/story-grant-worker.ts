import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
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
export const STORY_GRANT_MAX_ATTEMPTS = 3;
export const STORY_GRANT_RETRY_BASE_DELAY_MS = 100;

export type StoryGrantWorkerResult = {
  batches: number;
  learners: number;
  failedLearners: number;
  grants: number;
  retries: number;
  batchLimitReached: boolean;
};

const termStartDayText = sql`(${learnerFacts.metadata}->>'term_start_day')`;
const termEndDayText = sql`(${learnerFacts.metadata}->>'term_end_day')`;
const timeZoneText = sql`(${learnerFacts.metadata}->>'term_timezone')`;
const weekIndexText = sql`(${learnerFacts.metadata}->>'week_index')`;
const weekStartDayText = sql`(${learnerFacts.metadata}->>'week_start_day')`;
const weekStartDay = sql`coalesce(
  nullif(${weekStartDayText}, '')::date,
  (${learnerFacts.metadata}->>'term_start_day')::date
    + ((((${learnerFacts.metadata}->>'week_index')::int) - 1) * 7)
)`;
const friday = sql`(${weekStartDay}
  + ((5 - extract(isodow from ${weekStartDay})::int + 7) % 7))`;
const dueDay = sql`(least(
  ${friday},
  (${learnerFacts.metadata}->>'term_end_day')::date
) + 1)`;

function safeIsoCalendarDay(dayText: SQL): SQL {
  return sql`CASE
    WHEN ${dayText} ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (
      substring(${dayText} from 1 for 4)::int between 1 and 9999
      AND substring(${dayText} from 6 for 2)::int between 1 and 12
      AND substring(${dayText} from 9 for 2)::int between 1 AND CASE
        WHEN substring(${dayText} from 6 for 2)::int in (4, 6, 9, 11) THEN 30
        WHEN substring(${dayText} from 6 for 2)::int = 2 THEN CASE
          WHEN substring(${dayText} from 1 for 4)::int % 400 = 0
            OR (
              substring(${dayText} from 1 for 4)::int % 4 = 0
              AND substring(${dayText} from 1 for 4)::int % 100 <> 0
            ) THEN 29
          ELSE 28
        END
        ELSE 31
      END
    )
    ELSE false
  END`;
}

// All casts and timezone evaluation stay inside the true arm of this CASE.
// Historical JSON predating today's contract can therefore be quarantined by
// the query instead of aborting the entire cron invocation.
const safeCalendarMetadata = sql`(
  jsonb_typeof(${learnerFacts.metadata}->'term_start_day') = 'string'
  AND ${safeIsoCalendarDay(termStartDayText)}
  AND jsonb_typeof(${learnerFacts.metadata}->'term_end_day') = 'string'
  AND ${safeIsoCalendarDay(termEndDayText)}
  AND jsonb_typeof(${learnerFacts.metadata}->'term_timezone') = 'string'
  AND EXISTS (
    SELECT 1 FROM pg_timezone_names
    WHERE name = ${timeZoneText}
  )
  AND jsonb_typeof(${learnerFacts.metadata}->'week_index') = 'number'
  AND ${weekIndexText} ~ '^[0-9]+$'
  AND length(${weekIndexText}) <= 2
  AND (
    NOT (${learnerFacts.metadata} ? 'week_start_day')
    OR (
      jsonb_typeof(${learnerFacts.metadata}->'week_start_day') = 'string'
      AND ${safeIsoCalendarDay(weekStartDayText)}
    )
  )
)`;

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
        sql`CASE WHEN ${safeCalendarMetadata} THEN (
          ${weekStartDay} >= (${termStartDayText})::date
          AND ${weekStartDay} <= (${termEndDayText})::date
          AND (${input.asOf} at time zone ${timeZoneText})::date >= ${dueDay}
          AND ${dueDay}::timestamp at time zone ${timeZoneText} >= ${input.rolloutEffectiveAt}
        ) ELSE false END`,
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
    // Do not spend the connection's full statement timeout waiting behind an
    // accepted event or concurrent cron. lock_timeout produces 55P03, which the
    // bounded worker retry loop can recover within this invocation.
    await tx.execute(sql`SET LOCAL lock_timeout = '1500ms'`);
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
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    // Deterministic integration-test seam; production always leaves this unset.
    onlyLearnerIds?: readonly string[];
    db?: Db;
    findLearners?: typeof findLearnersWithDueStoryGrants;
    reconcileLearner?: typeof reconcileDueStoryGrantsForLearner;
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
  const maxAttempts = Math.max(
    1,
    Math.min(options.maxAttempts ?? STORY_GRANT_MAX_ATTEMPTS, 5),
  );
  const retryBaseDelayMs = Math.max(
    0,
    Math.min(
      options.retryBaseDelayMs ?? STORY_GRANT_RETRY_BASE_DELAY_MS,
      2_000,
    ),
  );
  const findLearners = options.findLearners ?? findLearnersWithDueStoryGrants;
  const reconcileLearner = options.reconcileLearner ??
    reconcileDueStoryGrantsForLearner;
  let batches = 0;
  let learnersProcessed = 0;
  let failedLearners = 0;
  let grants = 0;
  let retries = 0;
  let afterLearnerId: string | undefined;
  let lastBatchWasFull = false;

  const retry = async <T>(input: {
    scope: "discovery" | "learner";
    correlationId: string;
    operation: () => Promise<T>;
  }): Promise<
    | { ok: true; value: T; retries: number }
    | { ok: false; retries: number }
  > => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return {
          ok: true,
          value: await input.operation(),
          retries: attempt - 1,
        };
      } catch (error) {
        const retryable = isRetryableStoryGrantFailure(error, input.scope);
        const finalAttempt = !retryable || attempt === maxAttempts;
        const details = {
          scope: input.scope,
          correlationId: input.correlationId,
          attempt,
          maxAttempts,
          retryable,
          code: sanitizedFailureCode(error),
        };
        if (finalAttempt) {
          console.error("[pal] scheduled story grant operation failed", details);
          return { ok: false, retries: attempt - 1 };
        }
        console.warn("[pal] retrying scheduled story grant operation", details);
        await waitForRetry(retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw new Error("unreachable story grant retry state");
  };

  while (batches < maxBatches) {
    const discovery = await retry({
      scope: "discovery",
      correlationId: `batch-${batches + 1}`,
      operation: () => findLearners(db, {
        asOf,
        rolloutEffectiveAt: effectiveAt,
        afterLearnerId,
        onlyLearnerIds: options.onlyLearnerIds,
        limit: batchSize,
      }),
    });
    retries += discovery.retries;
    if (!discovery.ok) {
      throw new Error("scheduled story grant discovery failed after retries");
    }
    const learnerIds = discovery.value;
    if (learnerIds.length === 0) break;
    batches += 1;
    lastBatchWasFull = learnerIds.length === batchSize;
    afterLearnerId = learnerIds.at(-1);

    for (let offset = 0; offset < learnerIds.length; offset += concurrency) {
      const results = await Promise.all(
        learnerIds.slice(offset, offset + concurrency).map((learnerId) => retry({
          scope: "learner",
          correlationId: learnerCorrelationId(learnerId),
          operation: () => reconcileLearner(learnerId, {
            asOf,
            rolloutEffectiveAt: effectiveAt,
            db,
          }),
        })),
      );
      for (const result of results) {
        learnersProcessed += 1;
        retries += result.retries;
        if (result.ok) {
          grants += result.value.granted;
        } else {
          failedLearners += 1;
          // The retry helper already emitted one sanitized terminal record.
        }
      }
    }
  }

  return {
    batches,
    learners: learnersProcessed,
    failedLearners,
    grants,
    retries,
    batchLimitReached: batches === maxBatches && lastBatchWasFull,
  };
}

function learnerCorrelationId(learnerId: string): string {
  return createHash("sha256").update(learnerId).digest("hex").slice(0, 16);
}

function sanitizedFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(error.name)) {
    return error.name;
  }
  return "unknown";
}

function isRetryableStoryGrantFailure(
  error: unknown,
  scope: "discovery" | "learner",
): boolean {
  const code = sanitizedFailureCode(error);
  return (scope === "learner" && code === "57014") ||
    code.startsWith("08") || new Set([
    "40001", // serialization_failure
    "40P01", // deadlock_detected
    "53300", // too_many_connections
    "55P03", // lock_not_available
    "57P03", // cannot_connect_now
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
  ]).has(code);
}

async function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
