import assert from "node:assert/strict";
import { after, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import { achievementPeriods, getDb, getPool } from "@pal/db";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  type PalWidgetSnapshot,
} from "@codepet/pal-widget";
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
import {
  addDays,
  eventForAction,
  eventsForAction,
  FICTIONAL_SEMESTER_START_ISO,
} from "@/app/sandbox/sandbox-events";

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

function weeklyRhythmRoadmap(snapshot: PalWidgetSnapshot) {
  return {
    currentWeek: snapshot.roadmap.currentWeek,
    weeks: snapshot.roadmap.weeks.slice(0, 2).map((week) => {
      const rhythm = week.achievements.find(
        (achievement) => achievement.title === "Weekly Rhythm",
      );
      return {
        number: week.number,
        status: week.status,
        rhythm: rhythm
          ? {
              status: rhythm.status,
              progress: rhythm.progress,
            }
          : null,
      };
    }),
  };
}

function itemOutcomeCounts(snapshot: PalWidgetSnapshot) {
  const achievements = snapshot.roadmap.weeks.flatMap(
    (week) => week.achievements,
  );
  return {
    onTime: achievements.filter(
      (achievement) =>
        achievement.title === "On-Time Finish" &&
        achievement.status === "earned",
    ).length,
    rewards: snapshot.rewards.length,
    companion: {
      mood: snapshot.companion.mood,
      message: snapshot.companion.message,
      xp: snapshot.companion.xp,
      streak: snapshot.companion.streak,
    },
  };
}

test(
  "public fixture matches the persisted Weekly Rhythm scenario",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `fixture-parity-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const weekOne = new Date(FICTIONAL_SEMESTER_START_ISO);
    const weekTwo = addDays(weekOne, 7);
    const fixture = createFixturePalClient(createEmptyFixtureSnapshot());

    try {
      fixture.dispatch("daily-log-completed", { activityDay: "2026-04-13" });
      fixture.dispatch("daily-log-completed", { activityDay: "2026-04-13" });
      fixture.dispatch("on-time-finish", { itemToken: "parity-item-a" });
      fixture.dispatch("late-finish", { itemToken: "parity-item-a" });
      fixture.dispatch("on-time-finish", { itemToken: "parity-item-b" });
      fixture.dispatch("advance-week");

      const duplicateDailyLog = eventForAction(
        "daily-log-completed",
        weekOne,
        externalLearnerId,
      );
      const firstItem = eventForAction(
        "on-time-finish",
        weekOne,
        externalLearnerId,
      );
      const secondItem = eventForAction(
        "on-time-finish",
        weekOne,
        externalLearnerId,
      );
      const duplicateItem = eventForAction(
        "late-finish",
        weekOne,
        externalLearnerId,
      );
      const requests = [
        ...eventsForAction("daily-log-completed", weekOne, externalLearnerId),
        duplicateDailyLog,
        firstItem
          ? {
              ...firstItem,
              metadata: { ...firstItem.metadata, item_token: "parity-item-a" },
            }
          : null,
        duplicateItem
          ? {
              ...duplicateItem,
              metadata: {
                ...duplicateItem.metadata,
                item_token: "parity-item-a",
              },
            }
          : null,
        secondItem
          ? {
              ...secondItem,
              metadata: { ...secondItem.metadata, item_token: "parity-item-b" },
            }
          : null,
        eventForAction("week-configured", weekTwo, externalLearnerId),
      ].filter((request) => request !== null);

      for (const request of requests) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          {
            event_type: request.event_type,
            occurred_at: request.occurred_at,
            metadata: request.metadata,
          },
          request.idempotency_key,
        );
      }

      const internalLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const persisted = await loadLearnerSnapshot(
        integration.id,
        internalLearnerId,
      );

      assert.deepEqual(
        weeklyRhythmRoadmap(fixture.peek()),
        weeklyRhythmRoadmap(persisted),
      );
      assert.deepEqual(itemOutcomeCounts(fixture.peek()), itemOutcomeCounts(persisted));
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

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
  "rejects contradictory closure and permits only a valid closed correction",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `weekly-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `reconcile-week-${crypto.randomUUID()}`;
    const initialConfigurationKey = key();
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "closed",
          eligible_days: 0,
        }),
        initialConfigurationKey,
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log.completed", {
          period_key: periodKey,
          activity_day: "2026-07-20",
        }),
        key(),
      );
      const acceptedRetry = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "closed",
          eligible_days: 0,
        }),
        initialConfigurationKey,
      );
      assert.deepEqual(acceptedRetry, { status: "duplicate" });

      const semanticRetry = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "closed",
          eligible_days: 0,
        }),
        key(),
      );
      assert.deepEqual(semanticRetry, { status: "semantic_duplicate" });

      const contradictory = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "closed",
          eligible_days: 0,
        }),
        key(),
      );
      assert.deepEqual(contradictory, {
        status: "rejected",
        error: "contradictory_period_configuration",
      });

      const reopened = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "open",
          eligible_days: 1,
        }),
        key(),
      );
      assert.deepEqual(reopened, {
        status: "rejected",
        error: "closed_period_revision",
      });

      const corrected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "closed",
          eligible_days: 1,
        }),
        key(),
      );
      assert.equal(corrected.status, "processed");

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
      assert.equal(rhythm?.status, "earned");
      assert.deepEqual(rhythm?.progress, {
        current: 1,
        target: 1,
        label: "1 of 1 eligible days",
      });
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "orders sixteen opaque periods by authoritative time, not delivery order",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `ordering-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKeys = Array.from(
      { length: 16 },
      (_, index) => `opaque-week-${String(index + 1).padStart(2, "0")}-${crypto.randomUUID()}`,
    );
    try {
      for (let index = periodKeys.length - 1; index >= 0; index -= 1) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: periodKeys[index],
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
            },
            new Date(Date.UTC(2026, 0, 5 + index * 7, 12)).toISOString(),
          ),
          key(),
        );
      }

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const rows = await getDb()
        .select({ periodKey: achievementPeriods.periodKey })
        .from(achievementPeriods)
        .where(eq(achievementPeriods.learnerId, learnerId))
        .orderBy(asc(achievementPeriods.anchorAt));
      assert.deepEqual(
        rows.map((row) => row.periodKey),
        periodKeys,
      );

      const snapshot = await loadLearnerSnapshot(integration.id, learnerId);
      assert.equal(snapshot.roadmap.currentWeek, 16);
      assert.equal(
        snapshot.roadmap.weeks.filter((week) =>
          week.achievements.some(
            (achievement) => achievement.title === "Weekly Rhythm",
          ),
        ).length,
        16,
      );
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

test(
  "reads each learner snapshot entirely before or after a concurrent event commit",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `snapshot-consistency-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    let releaseRead = () => {};

    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("platform.session.started", {}),
        key(),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const before = await loadLearnerSnapshot(integration.id, learnerId);

      let markScopeVerified = () => {};
      const scopeVerified = new Promise<void>((resolve) => {
        markScopeVerified = resolve;
      });
      const continueRead = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const inFlightSnapshot = loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        async () => {
          markScopeVerified();
          await continueRead;
        },
      );

      await scopeVerified;
      try {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event("learning_item.completed", {
            item_token: `snapshot-item-${crypto.randomUUID()}`,
            kind: "assignment",
            period_key: `snapshot-period-${crypto.randomUUID()}`,
            timing: "on_time",
          }),
          key(),
        );
      } finally {
        releaseRead();
      }

      const duringCommit = await inFlightSnapshot;
      const afterCommit = await loadLearnerSnapshot(integration.id, learnerId);
      assert.deepEqual(duringCommit, before);
      assert.equal(afterCommit.rewards.length, before.rewards.length + 1);
      assert.equal(
        afterCommit.roadmap.weeks.some((week) =>
          week.achievements.some(
            (achievement) => achievement.title === "On-Time Finish",
          ),
        ),
        true,
      );
    } finally {
      releaseRead();
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
