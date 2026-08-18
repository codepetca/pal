import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  getDb,
  getPool,
  learnerFacts,
  learnerRewardGrants,
  storyCollectibleSchedules,
  type Db,
} from "@pal/db";
import { GET as runCronRoute } from "@/app/api/cron/story-collectibles/route";
import {
  getOrCreateLearnerIdentity,
  processEventInDb,
  resetLearnerInDb,
} from "@/lib/db-learner";
import { resolveIntegration } from "@/lib/integration-auth";
import {
  acknowledgeLearnerReward,
  loadLearnerSnapshot,
} from "@/lib/learner-snapshot";
import {
  findLearnersWithDueStoryGrants,
  reconcileDueStoryGrantsForLearner,
  STORY_GRANT_MAX_LEARNERS_PER_RUN,
  runStoryGrantWorker,
} from "@/lib/story-grant-worker";
import {
  storyGrantCronOutcome,
  storyGrantCronResponse,
} from "@/lib/story-grant-cron-result";

const secret = "story-worker-test-secret-at-least-32-characters";
const cronSecret = "story_worker_cron_secret_1234567890";
process.env.SANDBOX_INTEGRATION_SECRET = secret;

type Calendar = {
  termStartDay: string;
  termEndDay: string;
  timeZone: string;
  totalWeeks: number;
};

const normalTerm: Calendar = {
  termStartDay: "2026-08-31",
  termEndDay: "2026-10-09",
  timeZone: "America/Toronto",
  totalWeeks: 6,
};

function configuredWeek(
  periodKey: string,
  termKey: string,
  weekIndex: number,
  weekStartDay: string,
  calendar: Calendar = normalTerm,
) {
  return {
    event_type: "daily_log_week.configured",
    occurred_at: `${weekStartDay}T12:00:00.000Z`,
    metadata: {
      period_key: periodKey,
      config_version: 1,
      period_status: "open",
      eligible_days: 1,
      term_token: termKey,
      term_start_day: calendar.termStartDay,
      term_end_day: calendar.termEndDay,
      term_timezone: calendar.timeZone,
      term_week_count: calendar.totalWeeks,
      week_start_day: weekStartDay,
      week_index: weekIndex,
    },
  };
}

function dailyLog(periodKey: string, activityDay: string) {
  return {
    event_type: "daily_log.completed",
    occurred_at: `${activityDay}T15:00:00.000Z`,
    metadata: { period_key: periodKey, activity_day: activityDay },
  };
}

async function configure(
  integrationId: string,
  externalLearnerId: string,
  event: ReturnType<typeof configuredWeek>,
) {
  const result = await processEventInDb(
    integrationId,
    externalLearnerId,
    event,
    crypto.randomUUID(),
    { storyGrantAsOf: new Date("2026-08-01T00:00:00.000Z") },
  );
  assert.equal(result.status, "processed");
}

test(
  "Weekly Rhythm before the due day changes finish only after scheduled ownership exists",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-earned-first-${crypto.randomUUID()}`;
    const periodKey = `worker-earned-first-period-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          periodKey,
          `worker-earned-first-term-${crypto.randomUUID()}`,
          1,
          "2026-08-31",
        ),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLog(periodKey, "2026-08-31"),
        crypto.randomUUID(),
        { storyGrantAsOf: new Date("2026-09-03T12:00:00.000Z") },
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      assert.equal(
        (await getDb().select().from(learnerRewardGrants).where(and(
          eq(learnerRewardGrants.learnerId, learnerId),
          eq(learnerRewardGrants.kind, "story_chapter"),
        ))).length,
        0,
      );

      const worker = await runStoryGrantWorker({
        asOf: new Date("2026-09-05T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(worker.grants, 1);
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-05T12:00:00.000Z") },
      );
      const first = snapshot.progression?.collectibles[0];
      assert.equal(first?.status === "earned" ? first.finish : undefined, "color");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "an accepted event repairs an overdue grant through the shared reconciler",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-event-recovery-${crypto.randomUUID()}`;
    const periodKey = `worker-event-recovery-period-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          periodKey,
          `worker-event-recovery-term-${crypto.randomUUID()}`,
          1,
          "2026-08-31",
        ),
      );

      const recovered = await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLog(periodKey, "2026-08-31"),
        crypto.randomUUID(),
        { storyGrantAsOf: new Date("2026-09-05T12:00:00.000Z") },
      );
      assert.equal(recovered.status, "processed");

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const grants = await getDb().select().from(learnerRewardGrants).where(and(
        eq(learnerRewardGrants.learnerId, learnerId),
        eq(learnerRewardGrants.kind, "story_chapter"),
      ));
      assert.equal(grants.length, 1);

      const retry = await runStoryGrantWorker({
        asOf: new Date("2026-09-05T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(retry.grants, 0);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "missed runs grant every overdue week as a sketch and delayed rhythm upgrades in place",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-catchup-${crypto.randomUUID()}`;
    const termKey = `worker-catchup-term-${crypto.randomUUID()}`;
    const periodKeys = Array.from(
      { length: 3 },
      () => `worker-catchup-period-${crypto.randomUUID()}`,
    );
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(periodKeys[0]!, termKey, 1, "2026-08-31"),
      );
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(periodKeys[1]!, termKey, 2, "2026-09-07"),
      );
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(periodKeys[2]!, termKey, 3, "2026-09-14"),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );

      const worker = await runStoryGrantWorker({
        asOf: new Date("2026-09-19T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(worker.failedLearners, 0);
      assert.equal(worker.grants, 3);

      const before = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-19T12:00:00.000Z") },
      );
      assert.deepEqual(
        before.progression?.collectibles.slice(0, 3).map((collectible) =>
          collectible.status === "earned" ? collectible.finish : collectible.status
        ),
        ["sketch", "sketch", "sketch"],
      );
      const sketchReward = before.rewards.find(
        (reward) => reward.kind === "story" && reward.collectibleFinish === "sketch",
      );
      assert.ok(sketchReward);
      const legacyBefore = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        {
          asOf: new Date("2026-09-19T12:00:00.000Z"),
          supportsCollectibleFinish: false,
        },
      );
      assert.equal(
        legacyBefore.progression?.collectibles.some(
          (collectible) => collectible.status === "earned",
        ),
        false,
      );
      assert.equal(
        legacyBefore.rewards.some((reward) => reward.kind === "story"),
        false,
      );

      const achievement = await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLog(periodKeys[1]!, "2026-09-07"),
        crypto.randomUUID(),
        { storyGrantAsOf: new Date("2026-09-19T12:00:00.000Z") },
      );
      assert.equal(achievement.status, "processed");
      const grants = await getDb()
        .select()
        .from(learnerRewardGrants)
        .where(
          and(
            eq(learnerRewardGrants.learnerId, learnerId),
            eq(learnerRewardGrants.kind, "story_chapter"),
          ),
        );
      assert.equal(grants.length, 3);

      const upgraded = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-19T12:00:00.000Z") },
      );
      const second = upgraded.progression?.collectibles[1];
      assert.equal(
        second?.status === "earned" ? second.finish : undefined,
        "color",
      );
      const legacyUpgraded = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        {
          asOf: new Date("2026-09-19T12:00:00.000Z"),
          supportsCollectibleFinish: false,
        },
      );
      const legacySecond = legacyUpgraded.progression?.collectibles[1];
      assert.equal(
        legacySecond?.status === "earned" ? legacySecond.finish : undefined,
        "color",
      );
      assert.equal(
        legacyUpgraded.progression?.collectibles[0]?.status,
        "next",
      );
      const secondGrant = grants.find((grant) =>
        upgraded.rewards.some(
          (reward) => reward.id === grant.id && reward.kind === "story",
        )
      );
      assert.ok(secondGrant);
      await acknowledgeLearnerReward(
        integration.id,
        learnerId,
        secondGrant.id,
        getDb(),
      );
      const acknowledged = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-19T12:00:00.000Z") },
      );
      assert.equal(
        acknowledged.rewards.some((reward) => reward.id === secondGrant.id),
        false,
      );
      assert.equal(acknowledged.progression?.collectibles[1]?.status, "earned");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "concurrent duplicate workers lock the learner and grant one collectible",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-concurrent-${crypto.randomUUID()}`;
    const termKey = `worker-concurrent-term-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          `worker-concurrent-period-${crypto.randomUUID()}`,
          termKey,
          1,
          "2026-08-31",
        ),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const runs = await Promise.all([
        runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          onlyLearnerIds: [learnerId],
        }),
        runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          onlyLearnerIds: [learnerId],
        }),
      ]);
      assert.equal(runs.reduce((sum, run) => sum + run.grants, 0), 1);
      assert.equal(
        (
          await getDb()
            .select()
            .from(learnerRewardGrants)
            .where(eq(learnerRewardGrants.learnerId, learnerId))
        ).length,
        1,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "bounded batches process multiple overdue learners and weeks",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const learnerIds = Array.from(
      { length: 4 },
      () => `worker-batch-${crypto.randomUUID()}`,
    );
    try {
      const internalLearnerIds: string[] = [];
      for (const externalLearnerId of learnerIds) {
        await configure(
          integration.id,
          externalLearnerId,
          configuredWeek(
            `worker-batch-period-${crypto.randomUUID()}`,
            `worker-batch-term-${crypto.randomUUID()}`,
            1,
            "2026-08-31",
          ),
        );
        internalLearnerIds.push(await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        ));
      }
      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-05T12:00:00.000Z"),
        batchSize: 2,
        maxBatches: 2,
        concurrency: 2,
        onlyLearnerIds: internalLearnerIds,
      });
      assert.deepEqual(
        {
          batches: result.batches,
          learners: result.learners,
          failedLearners: result.failedLearners,
          grants: result.grants,
        },
        { batches: 2, learners: 4, failedLearners: 0, grants: 4 },
      );
    } finally {
      for (const externalLearnerId of learnerIds) {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "transient discovery and learner failures retry within the same run",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-retry-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          `worker-retry-period-${crypto.randomUUID()}`,
          `worker-retry-term-${crypto.randomUUID()}`,
          1,
          "2026-08-31",
        ),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      let discoveryAttempts = 0;
      let learnerAttempts = 0;
      const warnings: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args);
      try {
        const result = await runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          onlyLearnerIds: [learnerId],
          retryBaseDelayMs: 0,
          findLearners: async (...args) => {
            discoveryAttempts += 1;
            if (discoveryAttempts === 1) {
              throw new Error("must not be logged", {
                cause: { code: "40001" },
              });
            }
            return findLearnersWithDueStoryGrants(...args);
          },
          reconcileLearner: async (...args) => {
            learnerAttempts += 1;
            if (learnerAttempts === 1) {
              throw Object.assign(new Error(externalLearnerId), {
                // PostgreSQL uses this when the surrounding statement timeout
                // wins a lock race; learner-scoped retries must recover it.
                code: "57014",
              });
            }
            return reconcileDueStoryGrantsForLearner(...args);
          },
        });
        assert.equal(result.grants, 1);
        assert.equal(result.failedLearners, 0);
        assert.equal(result.retries, 2);
        // One retried first page plus the normal empty-page termination query.
        assert.equal(discoveryAttempts, 3);
        assert.equal(learnerAttempts, 2);
        assert.equal(warnings.length, 2);
        assert.equal(JSON.stringify(warnings).includes(externalLearnerId), false);
        assert.equal(JSON.stringify(warnings).includes("must not be logged"), false);
      } finally {
        console.warn = originalWarn;
      }
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "a wrapped real learner lock timeout retries after the lock is released",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-real-lock-${crypto.randomUUID()}`;
    const lockClient = await getPool().connect();
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          `worker-real-lock-period-${crypto.randomUUID()}`,
          `worker-real-lock-term-${crypto.randomUUID()}`,
          1,
          "2026-08-31",
        ),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      await lockClient.query("BEGIN");
      await lockClient.query('SELECT id FROM "learners" WHERE id = $1 FOR UPDATE', [
        learnerId,
      ]);
      const release = setTimeout(() => {
        void lockClient.query("COMMIT");
      }, 1_700);
      try {
        let discoveryCalls = 0;
        const result = await runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          onlyLearnerIds: [learnerId],
          retryBaseDelayMs: 0,
          findLearners: async () => {
            discoveryCalls += 1;
            return discoveryCalls === 1
              ? {
                  learnerIds: [learnerId],
                  scannedRows: 1,
                  cursor: {
                    dueAt: new Date("2026-09-05T04:00:00.000Z"),
                    id: learnerId,
                  },
                }
              : { learnerIds: [], scannedRows: 0 };
          },
        });
        assert.equal(result.grants, 1);
        assert.equal(result.retries, 1);
      } finally {
        clearTimeout(release);
        await lockClient.query("ROLLBACK");
      }
    } finally {
      lockClient.release();
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "typed due work remains authoritative because source facts are immutable",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const validLearner = `worker-valid-json-${crypto.randomUUID()}`;
    const malformedLearner = `worker-malformed-json-${crypto.randomUUID()}`;
    try {
      for (const externalLearnerId of [validLearner, malformedLearner]) {
        await configure(
          integration.id,
          externalLearnerId,
          configuredWeek(
            `worker-json-period-${crypto.randomUUID()}`,
            `worker-json-term-${crypto.randomUUID()}`,
            1,
            "2026-08-31",
          ),
        );
      }
      const validLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        validLearner,
      );
      const malformedLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        malformedLearner,
      );
      await assert.rejects(
        getDb().update(learnerFacts).set({
          metadata: {
            term_start_day: "2026-99-99",
            term_end_day: "not-a-day",
            term_timezone: "Not/A_Timezone",
            week_index: 1,
            week_start_day: "also-not-a-day",
          },
        }).where(and(
          eq(learnerFacts.learnerId, malformedLearnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
        )),
      );

      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-05T12:00:00.000Z"),
        onlyLearnerIds: [validLearnerId, malformedLearnerId],
      });
      assert.equal(result.grants, 2);
      assert.equal(result.failedLearners, 0);
      assert.equal(
        (await getDb().select().from(learnerRewardGrants).where(
          eq(learnerRewardGrants.learnerId, malformedLearnerId),
        )).length,
        1,
      );
      const [corruptedSchedule] = await getDb().select()
        .from(storyCollectibleSchedules)
        .where(eq(storyCollectibleSchedules.learnerId, malformedLearnerId));
      assert.ok(
        corruptedSchedule?.reconciledAt instanceof Date,
        "the typed queue should reconcile without rereading source JSON",
      );
    } finally {
      await resetLearnerInDb(integration.id, validLearner);
      await resetLearnerInDb(integration.id, malformedLearner);
    }
  },
);

test(
  "a terminal learner failure is sanitized and isolated from its batch",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearners = [
      `worker-terminal-${crypto.randomUUID()}`,
      `worker-terminal-${crypto.randomUUID()}`,
    ];
    try {
      const learnerIds: string[] = [];
      for (const externalLearnerId of externalLearners) {
        await configure(
          integration.id,
          externalLearnerId,
          configuredWeek(
            `worker-terminal-period-${crypto.randomUUID()}`,
            `worker-terminal-term-${crypto.randomUUID()}`,
            1,
            "2026-08-31",
          ),
        );
        learnerIds.push(await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        ));
      }
      const terminalLearnerId = learnerIds[0]!;
      let terminalAttempts = 0;
      const errors: unknown[][] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        const result = await runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          onlyLearnerIds: learnerIds,
          retryBaseDelayMs: 0,
          reconcileLearner: async (learnerId, input) => {
            if (learnerId === terminalLearnerId) {
              terminalAttempts += 1;
              throw Object.assign(new Error(externalLearners[0]!), {
                code: "22000",
              });
            }
            return reconcileDueStoryGrantsForLearner(learnerId, input);
          },
        });
        assert.equal(result.grants, 1);
        assert.equal(result.failedLearners, 1);
        assert.equal(result.retries, 0);
        assert.equal(terminalAttempts, 1);
        assert.equal(errors.length, 1);
        assert.equal(JSON.stringify(errors).includes(externalLearners[0]!), false);
      } finally {
        console.error = originalError;
      }
    } finally {
      for (const externalLearnerId of externalLearners) {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "a contract-valid weekend term start is granted after the following Friday",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-weekend-${crypto.randomUUID()}`;
    const periodKey = `worker-weekend-period-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          periodKey,
          `worker-weekend-term-${crypto.randomUUID()}`,
          1,
          "2026-09-06",
          {
            termStartDay: "2026-09-06",
            termEndDay: "2026-10-16",
            timeZone: "America/Toronto",
            totalWeeks: 6,
          },
        ),
      );
      const sundayActivity = await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLog(periodKey, "2026-09-06"),
        crypto.randomUUID(),
      );
      assert.deepEqual(sundayActivity, {
        status: "rejected",
        error: "inconsistent_activity_day",
      });
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-12T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(result.grants, 1);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "week-end reconciliation ignores the next instructional start and supports midweek term bounds",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const breakLearner = `worker-break-${crypto.randomUUID()}`;
    const midweekLearner = `worker-midweek-${crypto.randomUUID()}`;
    try {
      const breakTerm: Calendar = {
        termStartDay: "2026-10-05",
        termEndDay: "2026-11-27",
        timeZone: "America/Toronto",
        totalWeeks: 6,
      };
      const breakTermKey = `worker-break-term-${crypto.randomUUID()}`;
      await configure(
        integration.id,
        breakLearner,
        configuredWeek(
          `worker-break-one-${crypto.randomUUID()}`,
          breakTermKey,
          1,
          "2026-10-05",
          breakTerm,
        ),
      );
      await configure(
        integration.id,
        breakLearner,
        configuredWeek(
          `worker-break-two-${crypto.randomUUID()}`,
          breakTermKey,
          2,
          "2026-10-26",
          breakTerm,
        ),
      );
      const breakLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        breakLearner,
      );
      const breakResult = await runStoryGrantWorker({
        asOf: new Date("2026-10-10T12:00:00.000Z"),
        onlyLearnerIds: [breakLearnerId],
      });
      assert.equal(breakResult.grants, 1);

      const midweekTerm: Calendar = {
        termStartDay: "2026-09-02",
        termEndDay: "2026-10-07",
        timeZone: "America/Toronto",
        totalWeeks: 6,
      };
      const midweekTermKey = `worker-midweek-term-${crypto.randomUUID()}`;
      await configure(
        integration.id,
        midweekLearner,
        configuredWeek(
          `worker-midweek-first-${crypto.randomUUID()}`,
          midweekTermKey,
          1,
          "2026-09-02",
          midweekTerm,
        ),
      );
      await configure(
        integration.id,
        midweekLearner,
        configuredWeek(
          `worker-midweek-final-${crypto.randomUUID()}`,
          midweekTermKey,
          6,
          "2026-10-05",
          midweekTerm,
        ),
      );
      const midweekLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        midweekLearner,
      );
      const midweekResult = await runStoryGrantWorker({
        asOf: new Date("2026-10-08T12:00:00.000Z"),
        onlyLearnerIds: [midweekLearnerId],
      });
      assert.equal(midweekResult.grants, 2);
    } finally {
      await resetLearnerInDb(integration.id, breakLearner);
      await resetLearnerInDb(integration.id, midweekLearner);
    }
  },
);

test(
  "prospective pending schedules need no second rollout cutoff",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `worker-rollout-${crypto.randomUUID()}`;
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          `worker-rollout-period-${crypto.randomUUID()}`,
          `worker-rollout-term-${crypto.randomUUID()}`,
          1,
          "2026-08-31",
        ),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [schedule] = await getDb().select().from(storyCollectibleSchedules)
        .where(eq(storyCollectibleSchedules.learnerId, learnerId));
      assert.ok(schedule);
      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-20T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(result.grants, 1);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test("default daily capacity drains a cohort larger than the former 500-learner cap", async () => {
  assert.equal(STORY_GRANT_MAX_LEARNERS_PER_RUN, 10_000);
  const learnerIds = Array.from(
    { length: 501 },
    (_, index) => `learner-${String(index).padStart(3, "0")}`,
  );
  let offset = 0;
  const result = await runStoryGrantWorker({
    db: {} as Db,
    retryBaseDelayMs: 0,
    findLearners: async (_db, input) => {
      const page = learnerIds.slice(offset, offset + input.limit);
      offset += page.length;
      return {
        learnerIds: page,
        scannedRows: page.length,
        cursor: page.length > 0
          ? { dueAt: new Date("2026-09-05T04:00:00.000Z"), id: page.at(-1)! }
          : undefined,
      };
    },
    reconcileLearner: async () => ({ candidates: 1, due: 1, granted: 1 }),
  });
  assert.deepEqual(result, {
    batches: 6,
    learners: 501,
    failedLearners: 0,
    grants: 501,
    retries: 0,
    batchLimitReached: false,
  });
});

for (const [learnerCount, expectedBacklog] of [
  [10_000, false],
  [10_001, true],
] as const) {
  test(`capacity lookahead reports ${learnerCount} due learners accurately`, async () => {
    const learnerIds = Array.from(
      { length: learnerCount },
      (_, index) => `capacity-${String(index).padStart(5, "0")}`,
    );
    let offset = 0;
    const result = await runStoryGrantWorker({
      db: {} as Db,
      retryBaseDelayMs: 0,
      findLearners: async (_db, input) => {
        const page = learnerIds.slice(offset, offset + input.limit);
        offset += page.length;
        return {
          learnerIds: page,
          scannedRows: page.length,
          cursor: page.length > 0
            ? { dueAt: new Date("2026-09-05T04:00:00.000Z"), id: page.at(-1)! }
            : undefined,
        };
      },
      reconcileLearner: async () => ({ candidates: 1, due: 1, granted: 1 }),
    });
    assert.equal(result.learners, 10_000);
    assert.equal(result.batchLimitReached, expectedBacklog);
  });
}

test(
  "cron route rejects invalid deployment/auth configuration and runs when valid",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const original = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const missing = await runCronRoute(
        new NextRequest("http://localhost/api/cron/story-collectibles"),
      );
      assert.equal(missing.status, 503);

      process.env.CRON_SECRET = cronSecret;
      const denied = await runCronRoute(
        new NextRequest("http://localhost/api/cron/story-collectibles", {
          headers: { authorization: "Bearer wrong" },
        }),
      );
      assert.equal(denied.status, 401);

      const accepted = await runCronRoute(
        new NextRequest("http://localhost/api/cron/story-collectibles", {
          headers: { authorization: `Bearer ${cronSecret}` },
        }),
      );
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).status, "processed");
    } finally {
      if (original === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = original;
    }
  },
);

test("cron reports bounded-cap backlog as incomplete", () => {
  const outcome = storyGrantCronOutcome({
    batches: 20,
    learners: 500,
    failedLearners: 0,
    grants: 500,
    retries: 0,
    batchLimitReached: true,
  });
  assert.deepEqual(outcome, {
    bodyStatus: "incomplete",
    httpStatus: 503,
  });
});

test("cron response preserves failures when bounded-cap backlog remains", async () => {
  const response = storyGrantCronResponse({
    batches: 20,
    learners: 500,
    failedLearners: 2,
    grants: 498,
    retries: 6,
    batchLimitReached: true,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: "partial_failure_incomplete",
    batches: 20,
    learners: 500,
    failedLearners: 2,
    grants: 498,
    retries: 6,
    batchLimitReached: true,
  });
});
