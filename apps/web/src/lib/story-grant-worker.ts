import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  getDb,
  learners,
  storyCollectibleSchedules,
  type Db,
} from "@pal/db";
import {
  reconcileDueStoryGrants,
  type StoryGrantReconciliationResult,
} from "@/lib/story-grant-reconciler";

export const STORY_GRANT_BATCH_SIZE = 100;
export const STORY_GRANT_MAX_BATCHES = 100;
export const STORY_GRANT_CONCURRENCY = 10;
export const STORY_GRANT_MAX_LEARNERS_PER_RUN =
  STORY_GRANT_BATCH_SIZE * STORY_GRANT_MAX_BATCHES;
export const STORY_GRANT_MAX_ATTEMPTS = 3;
export const STORY_GRANT_RETRY_BASE_DELAY_MS = 100;
export const STORY_GRANT_RUN_BUDGET_MS = 270_000;
const STORY_GRANT_DISCOVERY_ROWS_PER_LEARNER = 24;

export type StoryGrantDiscoveryCursor = {
  dueAt: Date;
  id: string;
};

export type StoryGrantDiscoveryPage = {
  learnerIds: string[];
  cursor?: StoryGrantDiscoveryCursor;
  scannedRows: number;
};

export type StoryGrantWorkerResult = {
  batches: number;
  learners: number;
  failedLearners: number;
  grants: number;
  retries: number;
  batchLimitReached: boolean;
  learnerPageLimitReached: boolean;
  deadlineReached: boolean;
};

/** Returns one bounded, stable page of learners with at least one overdue slot. */
export async function findLearnersWithDueStoryGrants(
  db: Db,
  input: {
    asOf: Date;
    after?: StoryGrantDiscoveryCursor;
    excludedLearnerIds?: readonly string[];
    onlyLearnerIds?: readonly string[];
    limit: number;
  },
): Promise<StoryGrantDiscoveryPage> {
  if (input.onlyLearnerIds?.length === 0) {
    return { learnerIds: [], scannedRows: 0 };
  }
  const rowLimit = Math.min(
    input.limit * STORY_GRANT_DISCOVERY_ROWS_PER_LEARNER,
    2_400,
  );
  const rows = await db
    .select({
      id: storyCollectibleSchedules.id,
      dueAt: storyCollectibleSchedules.dueAt,
      learnerId: storyCollectibleSchedules.learnerId,
    })
    .from(storyCollectibleSchedules)
    .where(
      and(
        isNull(storyCollectibleSchedules.reconciledAt),
        lte(storyCollectibleSchedules.dueAt, input.asOf),
        ...(input.onlyLearnerIds
          ? [inArray(
              storyCollectibleSchedules.learnerId,
              [...input.onlyLearnerIds],
            )]
          : []),
        ...(input.excludedLearnerIds?.length
          ? [notInArray(
              storyCollectibleSchedules.learnerId,
              [...input.excludedLearnerIds],
            )]
          : []),
        ...(input.after
          ? [or(
              gt(storyCollectibleSchedules.dueAt, input.after.dueAt),
              and(
                eq(storyCollectibleSchedules.dueAt, input.after.dueAt),
                gt(storyCollectibleSchedules.id, input.after.id),
              ),
            )]
          : []),
      ),
    )
    .orderBy(
      asc(storyCollectibleSchedules.dueAt),
      asc(storyCollectibleSchedules.id),
    )
    .limit(rowLimit);

  const learnerIds: string[] = [];
  const seen = new Set<string>();
  let cursor: StoryGrantDiscoveryCursor | undefined;
  for (const row of rows) {
    cursor = { dueAt: row.dueAt, id: row.id };
    if (seen.has(row.learnerId)) continue;
    seen.add(row.learnerId);
    learnerIds.push(row.learnerId);
    if (learnerIds.length === input.limit) break;
  }
  return { learnerIds, cursor, scannedRows: rows.length };
}

/** Serializes one scheduled reconciliation with every other learner write. */
export async function reconcileDueStoryGrantsForLearner(
  learnerId: string,
  input: {
    asOf: Date;
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
    if (!learner) {
      return { candidates: 0, due: 0, granted: 0, hasMore: false };
    }
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
    });
  });
}

export async function runStoryGrantWorker(
  options: {
    asOf?: Date;
    batchSize?: number;
    maxBatches?: number;
    concurrency?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    deadline?: Date;
    now?: () => Date;
    // Deterministic integration-test seam; production always leaves this unset.
    onlyLearnerIds?: readonly string[];
    db?: Db;
    findLearners?: typeof findLearnersWithDueStoryGrants;
    reconcileLearner?: typeof reconcileDueStoryGrantsForLearner;
  } = {},
): Promise<StoryGrantWorkerResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? (() => new Date());
  const asOf = options.asOf ?? now();
  const deadline = options.deadline ?? new Date(
    now().getTime() + STORY_GRANT_RUN_BUDGET_MS,
  );
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
  let learnerPageLimitReached = false;
  let cursor: StoryGrantDiscoveryCursor | undefined;
  const failedLearnerIds = new Set<string>();
  let lastPageMayHaveMore = false;
  let deadlineReached = false;
  let knownDeadlineBacklog = false;

  const isPastDeadline = () => now().getTime() >= deadline.getTime();

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
    if (isPastDeadline()) {
      deadlineReached = true;
      break;
    }
    const discovery = await retry({
      scope: "discovery",
      correlationId: `batch-${batches + 1}`,
      operation: () => findLearners(db, {
        asOf,
        after: cursor,
        excludedLearnerIds: [...failedLearnerIds],
        onlyLearnerIds: options.onlyLearnerIds,
        limit: batchSize,
      }),
    });
    retries += discovery.retries;
    if (!discovery.ok) {
      throw new Error("scheduled story grant discovery failed after retries");
    }
    const { learnerIds } = discovery.value;
    if (learnerIds.length === 0) break;
    batches += 1;
    lastPageMayHaveMore = learnerIds.length === batchSize ||
      discovery.value.scannedRows === Math.min(
        batchSize * STORY_GRANT_DISCOVERY_ROWS_PER_LEARNER,
        2_400,
      );
    cursor = discovery.value.cursor;

    for (let offset = 0; offset < learnerIds.length; offset += concurrency) {
      const learnerChunk = learnerIds.slice(offset, offset + concurrency);
      if (isPastDeadline()) {
        deadlineReached = true;
        knownDeadlineBacklog = true;
        break;
      }
      const results = await Promise.all(learnerChunk.map((learnerId) => retry({
        scope: "learner",
        correlationId: learnerCorrelationId(learnerId),
        operation: () => reconcileLearner(learnerId, { asOf, db }),
      })));
      for (const [index, result] of results.entries()) {
        learnersProcessed += 1;
        retries += result.retries;
        if (result.ok) {
          grants += result.value.granted;
          learnerPageLimitReached ||= result.value.hasMore;
        } else {
          failedLearners += 1;
          failedLearnerIds.add(learnerChunk[index]!);
          // The retry helper already emitted one sanitized terminal record.
        }
      }
      if (deadlineReached) break;
    }
    if (deadlineReached) break;
  }

  let batchLimitReached = false;
  if (batches === maxBatches && lastPageMayHaveMore) {
    const lookahead = await retry({
      scope: "discovery",
      correlationId: "capacity-lookahead",
      operation: () => findLearners(db, {
        asOf,
        after: cursor,
        excludedLearnerIds: [...failedLearnerIds],
        onlyLearnerIds: options.onlyLearnerIds,
        limit: 1,
      }),
    });
    retries += lookahead.retries;
    if (!lookahead.ok) {
      throw new Error("scheduled story grant capacity lookahead failed after retries");
    }
    batchLimitReached = lookahead.value.learnerIds.length > 0;
  }

  if (deadlineReached && !knownDeadlineBacklog && lastPageMayHaveMore) {
    const lookahead = await retry({
      scope: "discovery",
      correlationId: "deadline-lookahead",
      operation: () => findLearners(db, {
        asOf,
        after: cursor,
        excludedLearnerIds: [...failedLearnerIds],
        onlyLearnerIds: options.onlyLearnerIds,
        limit: 1,
      }),
    });
    retries += lookahead.retries;
    if (!lookahead.ok) {
      throw new Error("scheduled story grant deadline lookahead failed after retries");
    }
    knownDeadlineBacklog = lookahead.value.learnerIds.length > 0;
  }

  return {
    batches,
    learners: learnersProcessed,
    failedLearners,
    grants,
    retries,
    batchLimitReached,
    learnerPageLimitReached,
    deadlineReached: deadlineReached && knownDeadlineBacklog,
  };
}

function learnerCorrelationId(learnerId: string): string {
  return createHash("sha256").update(learnerId).digest("hex").slice(0, 16);
}

function sanitizedFailureCode(error: unknown): string {
  const seen = new Set<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current)) break;
    seen.add(current);
    if ("code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code)) {
        return code;
      }
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
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
