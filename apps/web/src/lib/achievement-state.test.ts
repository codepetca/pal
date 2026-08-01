import assert from "node:assert/strict";
import { after, test } from "node:test";
import { getDb, getPool } from "@pal/db";
import {
  getOrCreateLearnerIdentity,
  processEventInDb,
  resetLearnerInDb,
} from "@/lib/db-learner";
import { resolveIntegration } from "@/lib/integration-auth";
import {
  acknowledgeLearnerReward,
  LearnerScopeError,
  loadLearnerSnapshot,
} from "@/lib/learner-snapshot";

const secret = "achievement-state-test-secret-at-least-32-characters";
const pikaSecret = "achievement-state-pika-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = secret;
process.env.PAL_INTEGRATION_SECRET = pikaSecret;

let openedDatabase = false;

function event(
  eventType: string,
  metadata: Record<string, unknown>,
  occurredAt = new Date().toISOString(),
) {
  return { event_type: eventType, occurred_at: occurredAt, metadata };
}

function key(): string {
  return `achievement-test-${crypto.randomUUID()}`;
}

test(
  "persists the five pilot achievements, semantic deduplication, and one reward",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `achievement-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `period-${crypto.randomUUID()}`;
    const dayOne = "2026-07-13";
    const dayTwo = "2026-07-14";

    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("platform.session.started", {}),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("platform.session.started", {}),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("classroom.joined", { classroom_token: "opaque-classroom" }),
        key(),
      );
      const duplicateClass = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("classroom.joined", { classroom_token: "opaque-classroom" }),
        key(),
      );
      assert.equal(duplicateClass.status, "semantic_duplicate");

      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 3,
        }),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: dayOne },
          `${dayOne}T17:00:00.000Z`,
        ),
        key(),
      );
      const duplicateDay = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: dayOne },
          `${dayOne}T18:00:00.000Z`,
        ),
        key(),
      );
      assert.equal(duplicateDay.status, "semantic_duplicate");
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: dayTwo },
          `${dayTwo}T17:00:00.000Z`,
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "open",
          eligible_days: 5,
        }),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("learning_item.viewed", {
          item_token: "opaque-viewed-item",
          kind: "assignment",
          period_key: periodKey,
          timing: "within_24h_of_release",
        }),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("learning_item.completed", {
          item_token: "opaque-completed-item",
          kind: "assignment",
          period_key: periodKey,
          timing: "on_time",
        }),
        key(),
      );
      const duplicateItem = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("learning_item.completed", {
          item_token: "opaque-completed-item",
          kind: "assignment",
          period_key: periodKey,
          timing: "on_time",
        }),
        key(),
      );
      assert.equal(duplicateItem.status, "semantic_duplicate");

      const internalLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        internalLearnerId,
      );
      const achievements = snapshot.roadmap.weeks.flatMap(
        (week) => week.achievements,
      );
      assert.deepEqual(
        new Set(achievements.map((achievement) => achievement.title)),
        new Set([
          "First Pika Login",
          "Joined the Class",
          "Weekly Rhythm",
          "Ready Early",
          "On-Time Finish",
        ]),
      );
      assert.equal(
        achievements.find((achievement) => achievement.title === "Weekly Rhythm")
          ?.status,
        "earned",
      );
      assert.equal(
        achievements.find((achievement) => achievement.title === "Weekly Rhythm")
          ?.progress?.target,
        2,
      );
      assert.equal(snapshot.companion.xp, 223);
      assert.equal(snapshot.rewards.length, 1);

      await acknowledgeLearnerReward(
        integration.id,
        internalLearnerId,
        snapshot.rewards[0].id,
      );
      await acknowledgeLearnerReward(
        integration.id,
        internalLearnerId,
        snapshot.rewards[0].id,
      );
      assert.equal(
        (await loadLearnerSnapshot(integration.id, internalLearnerId)).rewards
          .length,
        0,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "reconciles short weeks, counts delayed facts, and freezes closed periods",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `weekly-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `short-week-${crypto.randomUUID()}`;
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log.completed", {
          period_key: periodKey,
          activity_day: "2026-07-20",
        }),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 3,
        }),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "closed",
          eligible_days: 2,
        }),
        key(),
      );
      const rejected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 3,
          period_status: "closed",
          eligible_days: 1,
        }),
        key(),
      );
      assert.deepEqual(rejected, {
        status: "rejected",
        error: "closed_period_revision",
      });

      const internalLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        internalLearnerId,
      );
      const rhythm = snapshot.roadmap.weeks[0].achievements.find(
        (achievement) => achievement.title === "Weekly Rhythm",
      );
      assert.equal(rhythm?.status, "incomplete");
      assert.deepEqual(rhythm?.progress, {
        current: 1,
        target: 2,
        label: "1 of 2 eligible days",
      });
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps learner rewards and snapshots isolated across learners and integrations",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const learnerA = `isolation-a-${crypto.randomUUID()}`;
    const learnerB = `isolation-b-${crypto.randomUUID()}`;
    const sandbox = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const pika = await resolveIntegration({
      slug: "pika",
      name: "Pika",
      secret: pikaSecret,
    });
    try {
      for (const learner of [learnerA, learnerB]) {
        await processEventInDb(
          sandbox.id,
          learner,
          event("learning_item.completed", {
            item_token: `item-${learner}`,
            kind: "assignment",
            period_key: `period-${learner}`,
            timing: "on_time",
          }),
          key(),
        );
      }
      await processEventInDb(
        pika.id,
        learnerA,
        event("platform.session.started", {}),
        key(),
      );

      const sandboxAId = await getOrCreateLearnerIdentity(
        getDb(),
        sandbox.id,
        learnerA,
      );
      const sandboxBId = await getOrCreateLearnerIdentity(
        getDb(),
        sandbox.id,
        learnerB,
      );
      const pikaAId = await getOrCreateLearnerIdentity(getDb(), pika.id, learnerA);
      assert.notEqual(sandboxAId, pikaAId);

      const rewardB = (await loadLearnerSnapshot(sandbox.id, sandboxBId)).rewards[0];
      await acknowledgeLearnerReward(sandbox.id, sandboxAId, rewardB.id);
      assert.equal(
        (await loadLearnerSnapshot(sandbox.id, sandboxBId)).rewards.length,
        1,
      );
      await assert.rejects(
        loadLearnerSnapshot(pika.id, sandboxAId),
        LearnerScopeError,
      );
      assert.equal(
        (
          await loadLearnerSnapshot(pika.id, pikaAId)
        ).roadmap.weeks[0].achievements[0]?.title,
        "First Pika Login",
      );
    } finally {
      await resetLearnerInDb(sandbox.id, learnerA);
      await resetLearnerInDb(sandbox.id, learnerB);
      await resetLearnerInDb(pika.id, learnerA);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
