import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  getDb,
  learnerFacts,
  learnerRewardGrants,
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
  runStoryGrantWorker,
} from "@/lib/story-grant-worker";

const secret = "story-worker-test-secret-at-least-32-characters";
const cronSecret = "story_worker_cron_secret_1234567890";
const rollout = new Date("2026-01-01T00:00:00.000Z");
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
        rolloutEffectiveAt: rollout,
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
        rolloutEffectiveAt: rollout,
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
        rolloutEffectiveAt: rollout,
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
          rolloutEffectiveAt: rollout,
          onlyLearnerIds: [learnerId],
        }),
        runStoryGrantWorker({
          asOf: new Date("2026-09-05T12:00:00.000Z"),
          rolloutEffectiveAt: rollout,
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
        rolloutEffectiveAt: rollout,
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
          rolloutEffectiveAt: rollout,
          onlyLearnerIds: [learnerId],
          retryBaseDelayMs: 0,
          findLearners: async (...args) => {
            discoveryAttempts += 1;
            if (discoveryAttempts === 1) {
              throw Object.assign(new Error("must not be logged"), {
                code: "40001",
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
  "malformed historical calendar JSON is quarantined without blocking valid learners",
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
      await getDb().update(learnerFacts).set({
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
      ));

      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-05T12:00:00.000Z"),
        rolloutEffectiveAt: rollout,
        onlyLearnerIds: [validLearnerId, malformedLearnerId],
      });
      assert.equal(result.grants, 1);
      assert.equal(result.failedLearners, 0);
      assert.equal(
        (await getDb().select().from(learnerRewardGrants).where(
          eq(learnerRewardGrants.learnerId, malformedLearnerId),
        )).length,
        0,
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
          rolloutEffectiveAt: rollout,
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
    try {
      await configure(
        integration.id,
        externalLearnerId,
        configuredWeek(
          `worker-weekend-period-${crypto.randomUUID()}`,
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
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const result = await runStoryGrantWorker({
        asOf: new Date("2026-09-12T12:00:00.000Z"),
        rolloutEffectiveAt: rollout,
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
        rolloutEffectiveAt: rollout,
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
        rolloutEffectiveAt: rollout,
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
  "rollout cutoff blocks pre-rollout provenance and already-due history",
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
      await getDb()
        .update(learnerFacts)
        .set({ createdAt: new Date("2026-08-01T00:00:00.000Z") })
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.eventType, "daily_log_week.configured"),
          ),
        );
      const provenanceCutoff = await runStoryGrantWorker({
        asOf: new Date("2026-09-20T12:00:00.000Z"),
        rolloutEffectiveAt: new Date("2026-08-02T00:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(provenanceCutoff.grants, 0);

      await getDb()
        .update(learnerFacts)
        .set({ createdAt: new Date("2026-09-10T00:00:00.000Z") })
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.eventType, "daily_log_week.configured"),
          ),
        );
      const dueCutoff = await runStoryGrantWorker({
        asOf: new Date("2026-09-20T12:00:00.000Z"),
        rolloutEffectiveAt: new Date("2026-09-06T00:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(dueCutoff.grants, 0);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

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
