import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  achievementPeriods,
  economy,
  events,
  getDb,
  getPool,
  learnerFacts,
  worldState,
} from "@pal/db";
import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  parsePalWidgetSnapshot,
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
      level: snapshot.companion.level,
      mood: snapshot.companion.mood,
      message: snapshot.companion.message,
      xp: snapshot.companion.xp,
      streak: snapshot.companion.streak,
    },
    collection: snapshot.collection?.items.map((item) => item.id) ?? [],
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
      assert.equal(snapshot.companion.xp, 195);
      assert.deepEqual(
        snapshot.collection?.items.map((item) => item.id),
        ["world-study-bird-v1"],
      );
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
  "persists Weekly Rhythm XP and collection milestones exactly once",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `progression-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      for (let index = 0; index < 4; index += 1) {
        const periodKey = `progression-week-${index + 1}-${crypto.randomUUID()}`;
        const activityDay = `2026-03-${String(2 + index * 7).padStart(2, "0")}`;
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: periodKey,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
            },
            `${activityDay}T12:00:00.000Z`,
          ),
          key(),
        );
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: periodKey, activity_day: activityDay },
            `${activityDay}T17:00:00.000Z`,
          ),
          key(),
        );

        const revision = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: periodKey,
              config_version: 2,
              period_status: "closed",
              eligible_days: 1,
            },
            `${activityDay}T18:00:00.000Z`,
          ),
          key(),
        );
        assert.equal(revision.status, "processed");
      }

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(integration.id, learnerId);
      assert.equal(snapshot.companion.xp, 340); // 4 × (10 daily + 75 weekly)
      assert.equal(snapshot.companion.level, 1);
      assert.deepEqual(
        snapshot.collection?.items.map((item) => item.id),
        ["world-study-bird-v1", "world-study-lamp-v1"],
      );

      // Simulate rollout from a release that already persisted the achievements
      // but had no collection rules. The next unrelated accepted event reconciles
      // keepsakes without back-paying Weekly Rhythm XP.
      await getDb()
        .update(worldState)
        .set({ unlockedObjectIds: [] })
        .where(eq(worldState.learnerId, learnerId));
      const rolloutSync = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("platform.session.started", {}),
        key(),
      );
      assert.equal(rolloutSync.status, "processed");
      assert.deepEqual(
        rolloutSync.status === "processed"
          ? rolloutSync.result.mutations
              .filter((mutation) => mutation.type === "WORLD_UNLOCK")
              .map((mutation) => mutation.asset_ref_id)
          : [],
        ["world-study-bird-v1", "world-study-lamp-v1"],
      );
      const reconciled = await loadLearnerSnapshot(integration.id, learnerId);
      assert.equal(reconciled.companion.xp, 340);
      assert.deepEqual(
        reconciled.collection?.items.map((item) => item.id),
        ["world-study-bird-v1", "world-study-lamp-v1"],
      );

      const alreadySynced = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("classroom.joined", {
          classroom_token: `classroom-${crypto.randomUUID()}`,
        }),
        key(),
      );
      assert.equal(alreadySynced.status, "processed");
      assert.deepEqual(
        alreadySynced.status === "processed"
          ? alreadySynced.result.mutations.filter(
              (mutation) => mutation.type === "WORLD_UNLOCK",
            )
          : [],
        [],
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "caps delayed Weekly Rhythm display progress and rewards it exactly once",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `delayed-rhythm-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `delayed-week-${crypto.randomUUID()}`;
    const configurationKey = key();
    try {
      for (const activityDay of [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
      ]) {
        const result = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: periodKey, activity_day: activityDay },
            `${activityDay}T16:00:00.000Z`,
          ),
          key(),
        );
        assert.equal(result.status, "processed");
      }

      const configuration = event(
        "daily_log_week.configured",
        {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 5,
          term_token: "term-delayed-rhythm",
          term_start_day: "2026-09-14",
          term_end_day: "2026-12-31",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_start_day: "2026-09-14",
          week_index: 1,
        },
        "2026-09-18T18:00:00.000Z",
      );
      const earned = await processEventInDb(
        integration.id,
        externalLearnerId,
        configuration,
        configurationKey,
      );
      assert.equal(earned.status, "processed");
      assert.deepEqual(
        earned.status === "processed"
          ? earned.result.mutations.filter(
              (mutation) => mutation.type === "WORLD_UNLOCK",
            )
          : [],
        [{ type: "WORLD_UNLOCK", asset_ref_id: "world-study-bird-v1" }],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(integration.id, learnerId, getDb(), {
        asOf: new Date("2026-09-18T20:00:00.000Z"),
      });
      const rhythm = snapshot.roadmap.weeks[0]?.achievements.find(
        (achievement) => achievement.title === "Weekly Rhythm",
      );
      assert.deepEqual(rhythm?.progress, {
        current: 4,
        target: 4,
        label: "4 of 4 eligible days",
      });
      assert.equal(snapshot.companion.xp, 125); // five daily logs + one weekly award
      assert.deepEqual(
        snapshot.collection?.items.map((item) => item.id),
        ["world-study-bird-v1"],
      );
      assert.deepEqual(parsePalWidgetSnapshot(snapshot), snapshot);

      assert.equal(
        (
          await processEventInDb(
            integration.id,
            externalLearnerId,
            configuration,
            configurationKey,
          )
        ).status,
        "duplicate",
      );
      assert.equal(
        (
          await processEventInDb(
            integration.id,
            externalLearnerId,
            event(
              "daily_log_week.configured",
              {
                ...configuration.metadata,
                config_version: 2,
                period_status: "closed",
              },
              "2026-09-18T19:00:00.000Z",
            ),
            key(),
          )
        ).status,
        "processed",
      );
      const afterRevision = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-18T20:00:00.000Z") },
      );
      assert.equal(afterRevision.companion.xp, 125);
      assert.deepEqual(
        afterRevision.roadmap.weeks[0]?.achievements.find(
          (achievement) => achievement.title === "Weekly Rhythm",
        )?.progress,
        rhythm?.progress,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "rejects an activity day outside the configured period timezone",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `timezone-day-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `timezone-week-${crypto.randomUUID()}`;
    const deliveryKey = key();
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "term-timezone-day",
            term_start_day: "2026-09-14",
            term_end_day: "2026-12-31",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 1,
          },
          "2026-09-14T12:00:00.000Z",
        ),
        key(),
      );
      const rejected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-15" },
          "2026-09-15T01:00:00.000Z",
        ),
        deliveryKey,
      );
      assert.deepEqual(rejected, {
        status: "rejected",
        error: "inconsistent_activity_day",
      });

      // Rejection happens before the event ledger, so the corrected payload can
      // safely reuse the producer's transport key.
      const corrected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-14" },
          "2026-09-15T01:00:00.000Z",
        ),
        deliveryKey,
      );
      assert.equal(corrected.status, "processed");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "quarantines a timezone-inconsistent completion received before configuration",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `pending-timezone-day-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `pending-timezone-week-${crypto.randomUUID()}`;
    const correctedKey = key();
    try {
      const pending = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-15" },
          "2026-09-15T01:00:00.000Z",
        ),
        key(),
      );
      assert.equal(pending.status, "processed");
      assert.deepEqual(
        pending.status === "processed" ? pending.result.mutations : [],
        [],
      );

      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 1,
            term_token: "term-pending-timezone-day",
            term_start_day: "2026-09-14",
            term_end_day: "2026-12-31",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 1,
          },
          "2026-09-15T02:00:00.000Z",
        ),
        key(),
      );
      assert.equal(configured.status, "processed");
      assert.deepEqual(
        configured.status === "processed" ? configured.result.mutations : [],
        [],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const quarantined = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T03:00:00.000Z") },
      );
      assert.equal(quarantined.companion.xp, 0);
      assert.equal(quarantined.companion.streak, 0);
      assert.deepEqual(quarantined.collection?.items, []);
      assert.deepEqual(
        quarantined.roadmap.weeks[0]?.achievements.find(
          (achievement) => achievement.title === "Weekly Rhythm",
        )?.progress,
        { current: 0, target: 1, label: "0 of 1 eligible days" },
      );

      // The quarantined source fact remains immutable, while a corrected local
      // day is a distinct semantic fact and settles the daily and weekly rewards.
      const corrected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-14" },
          "2026-09-15T01:00:00.000Z",
        ),
        correctedKey,
      );
      assert.equal(corrected.status, "processed");
      const settled = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T03:00:00.000Z") },
      );
      assert.equal(settled.companion.xp, 85);
      assert.equal(settled.companion.streak, 1);
      assert.deepEqual(
        settled.collection?.items.map((item) => item.id),
        ["world-study-bird-v1"],
      );
      assert.equal(
        (
          await processEventInDb(
            integration.id,
            externalLearnerId,
            event(
              "daily_log.completed",
              { period_key: periodKey, activity_day: "2026-09-14" },
              "2026-09-15T01:00:00.000Z",
            ),
            correctedKey,
          )
        ).status,
        "duplicate",
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps corrected reward capacity separate from quarantined source facts",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `quarantine-capacity-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `quarantine-capacity-week-${crypto.randomUUID()}`;
    try {
      for (const activityDay of [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
      ]) {
        const pending = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: periodKey, activity_day: activityDay },
            `${activityDay}T16:00:00.000Z`,
          ),
          key(),
        );
        assert.equal(pending.status, "processed");
      }
      const quarantined = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-19" },
          "2026-09-19T03:30:00.000Z",
        ),
        key(),
      );
      assert.equal(quarantined.status, "processed");

      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "term-quarantine-capacity",
            term_start_day: "2026-09-14",
            term_end_day: "2026-12-31",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 1,
          },
          "2026-09-19T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(configured.status, "processed");
      assert.deepEqual(
        configured.status === "processed"
          ? configured.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 10, 10, 10, 75],
      );

      const corrected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-18" },
          "2026-09-19T03:30:00.000Z",
        ),
        key(),
      );
      assert.equal(corrected.status, "processed");
      assert.deepEqual(
        corrected.status === "processed"
          ? corrected.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [state] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(state.xpLifetime, 125);
      const [counts] = await getDb()
        .select({
          completions: sql<number>`count(*) filter (where ${learnerFacts.eventType} = 'daily_log.completed')::int`,
          settlements: sql<number>`count(*) filter (where ${learnerFacts.eventType} = 'internal.daily_log.reward_settlement')::int`,
        })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.periodKey, periodKey),
          ),
        );
      assert.deepEqual(counts, { completions: 6, settlements: 5 });
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "settles older pending daily XP without moving a newer rhythm backward",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `pending-before-newer-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const weekOne = `pending-week-one-${crypto.randomUUID()}`;
    const weekTwo = `configured-week-two-${crypto.randomUUID()}`;
    const weekOneConfigurationKey = key();
    try {
      for (const activityDay of ["2026-09-14", "2026-09-15"]) {
        const pending = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: weekOne, activity_day: activityDay },
            `${activityDay}T16:00:00.000Z`,
          ),
          key(),
        );
        assert.equal(pending.status, "processed");
        assert.deepEqual(
          pending.status === "processed" ? pending.result.mutations : [],
          [],
        );
      }

      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: weekTwo,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "term-pending-before-newer",
            term_start_day: "2026-09-14",
            term_end_day: "2026-12-31",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-21",
            week_index: 2,
          },
          "2026-09-21T12:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: weekTwo, activity_day: "2026-09-21" },
          "2026-09-21T16:00:00.000Z",
        ),
        key(),
      );

      const weekOneConfiguration = event(
        "daily_log_week.configured",
        {
          period_key: weekOne,
          config_version: 1,
          period_status: "open",
          eligible_days: 2,
          term_token: "term-pending-before-newer",
          term_start_day: "2026-09-14",
          term_end_day: "2026-12-31",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_start_day: "2026-09-14",
          week_index: 1,
        },
        "2026-09-22T12:00:00.000Z",
      );
      const settlement = await processEventInDb(
        integration.id,
        externalLearnerId,
        weekOneConfiguration,
        weekOneConfigurationKey,
      );
      assert.equal(settlement.status, "processed");
      assert.deepEqual(
        settlement.status === "processed"
          ? settlement.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 10, 75],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [state] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(state.xpLifetime, 105);
      assert.equal(state.streakCurrent, 1);
      assert.equal(state.streakLastDay, "2026-09-21");

      assert.equal(
        (
          await processEventInDb(
            integration.id,
            externalLearnerId,
            weekOneConfiguration,
            weekOneConfigurationKey,
          )
        ).status,
        "duplicate",
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...weekOneConfiguration.metadata, config_version: 2 },
          "2026-09-22T13:00:00.000Z",
        ),
        key(),
      );
      const [afterRevision] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(afterRevision.xpLifetime, 105);
      assert.equal(afterRevision.streakLastDay, "2026-09-21");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "pays a configured out-of-order daily log without moving the streak backward",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `configured-out-of-order-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `configured-out-of-order-week-${crypto.randomUUID()}`;
    const mondayKey = key();
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 2,
        }),
        key(),
      );
      const tuesday = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log.completed", {
          period_key: periodKey,
          activity_day: "2026-07-14",
        }),
        key(),
      );
      assert.equal(tuesday.status, "processed");

      const mondayEvent = event("daily_log.completed", {
        period_key: periodKey,
        activity_day: "2026-07-13",
      });
      const monday = await processEventInDb(
        integration.id,
        externalLearnerId,
        mondayEvent,
        mondayKey,
      );
      assert.equal(monday.status, "processed");
      assert.deepEqual(
        monday.status === "processed"
          ? monday.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 75],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [state] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(state.xpLifetime, 95);
      assert.equal(state.streakCurrent, 1);
      assert.equal(state.streakLastDay, "2026-07-14");

      assert.deepEqual(
        await processEventInDb(
          integration.id,
          externalLearnerId,
          mondayEvent,
          mondayKey,
        ),
        { status: "duplicate" },
      );
      const [afterRetry] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(afterRetry.xpLifetime, 95);
      assert.equal(afterRetry.streakLastDay, "2026-07-14");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "settles remaining pending rewards after each accepted higher configuration",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const scenarios = [
      {
        initialEligibleDays: 0,
        revisedEligibleDays: 2,
        activityDays: ["2026-07-13", "2026-07-14"],
        expectedRevisionXp: [10, 10, 75],
        expectedLifetimeXp: 95,
      },
      {
        initialEligibleDays: 1,
        revisedEligibleDays: 3,
        activityDays: ["2026-07-20", "2026-07-21", "2026-07-22"],
        expectedRevisionXp: [10, 10, 75],
        expectedLifetimeXp: 105,
      },
    ];

    for (const scenario of scenarios) {
      const externalLearnerId = `revision-settlement-${scenario.initialEligibleDays}-${crypto.randomUUID()}`;
      const periodKey = `revision-settlement-week-${crypto.randomUUID()}`;
      try {
        for (const activityDay of scenario.activityDays) {
          const pending = await processEventInDb(
            integration.id,
            externalLearnerId,
            event("daily_log.completed", { period_key: periodKey, activity_day: activityDay }),
            key(),
          );
          assert.equal(pending.status, "processed");
        }

        await processEventInDb(
          integration.id,
          externalLearnerId,
          event("daily_log_week.configured", {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: scenario.initialEligibleDays,
          }),
          key(),
        );

        const revision = event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 3,
          period_status: "open",
          eligible_days: scenario.revisedEligibleDays,
        });
        const revisionKey = key();
        const revised = await processEventInDb(
          integration.id,
          externalLearnerId,
          revision,
          revisionKey,
        );
        assert.equal(revised.status, "processed");
        assert.deepEqual(
          revised.status === "processed"
            ? revised.result.mutations
                .filter((mutation) => mutation.type === "XP_GRANT")
                .map((mutation) => mutation.amount)
            : [],
          scenario.expectedRevisionXp,
        );

        assert.deepEqual(
          await processEventInDb(
            integration.id,
            externalLearnerId,
            revision,
            revisionKey,
          ),
          { status: "duplicate" },
        );
        const stale = await processEventInDb(
          integration.id,
          externalLearnerId,
          event("daily_log_week.configured", {
            period_key: periodKey,
            config_version: 2,
            period_status: "open",
            eligible_days: scenario.revisedEligibleDays,
          }),
          key(),
        );
        assert.equal(stale.status, "processed");
        assert.deepEqual(
          stale.status === "processed"
            ? stale.result.mutations.filter(
                (mutation) => mutation.type === "XP_GRANT",
              )
            : [],
          [],
        );

        const learnerId = await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        );
        const [state] = await getDb()
          .select()
          .from(economy)
          .where(eq(economy.learnerId, learnerId));
        assert.equal(state.xpLifetime, scenario.expectedLifetimeXp);
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "holds post-configuration facts beyond the current allowance until correction",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `configured-allowance-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `configured-allowance-week-${crypto.randomUUID()}`;
    const calendar = {
      period_key: periodKey,
      period_status: "closed" as const,
      term_token: "term-configured-allowance",
      term_start_day: "2026-09-14",
      term_end_day: "2026-12-31",
      term_timezone: "America/Toronto",
      term_week_count: 16,
      week_start_day: "2026-09-14",
      week_index: 1,
    };
    try {
      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...calendar, config_version: 1, eligible_days: 1 },
          "2026-09-14T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(configured.status, "processed");

      const first = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-14" },
          "2026-09-14T16:00:00.000Z",
        ),
        key(),
      );
      assert.deepEqual(
        first.status === "processed"
          ? first.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 75],
      );

      const pending = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-15" },
          "2026-09-15T16:00:00.000Z",
        ),
        key(),
      );
      assert.equal(pending.status, "processed");
      assert.deepEqual(
        pending.status === "processed"
          ? pending.result.mutations.filter(
              (mutation) => mutation.type === "XP_GRANT",
            )
          : [],
        [],
      );

      // The second valid fact makes the closed period reconcilable without
      // paying it. A still-closed higher configuration releases exactly that
      // remaining day and cannot repeat the Weekly Rhythm award.
      const corrected = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...calendar, config_version: 2, eligible_days: 2 },
          "2026-09-16T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(corrected.status, "processed");
      assert.deepEqual(
        corrected.status === "processed"
          ? corrected.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [state] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(state.xpLifetime, 95);
      const [settlementCount] = await getDb()
        .select({ value: sql<number>`count(*)::int` })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.periodKey, periodKey),
            eq(
              learnerFacts.eventType,
              "internal.daily_log.reward_settlement",
            ),
          ),
        );
      assert.equal(settlementCount.value, 2);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "validates closure against every stored calendar-valid completion",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `closure-valid-facts-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `closure-valid-facts-week-${crypto.randomUUID()}`;
    try {
      for (const activityDay of [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
      ]) {
        const pending = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: periodKey, activity_day: activityDay },
            `${activityDay}T16:00:00.000Z`,
          ),
          key(),
        );
        assert.equal(pending.status, "processed");
      }

      const initial = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 1,
        }),
        key(),
      );
      assert.equal(initial.status, "processed");
      assert.deepEqual(
        initial.status === "processed"
          ? initial.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10],
      );

      const contradictory = await processEventInDb(
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
      assert.deepEqual(contradictory, {
        status: "rejected",
        error: "contradictory_period_configuration",
      });

      const closed = await processEventInDb(
        integration.id,
        externalLearnerId,
        event("daily_log_week.configured", {
          period_key: periodKey,
          config_version: 2,
          period_status: "closed",
          eligible_days: 3,
        }),
        key(),
      );
      assert.equal(closed.status, "processed");
      assert.deepEqual(
        closed.status === "processed"
          ? closed.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 10, 75],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [state] = await getDb()
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId));
      assert.equal(state.xpLifetime, 105);
      const [settlementCount] = await getDb()
        .select({ value: sql<number>`count(*)::int` })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.periodKey, periodKey),
            eq(
              learnerFacts.eventType,
              "internal.daily_log.reward_settlement",
            ),
          ),
        );
      assert.equal(settlementCount.value, 3);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "rejects more than five period days and bounds pending settlement",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `bounded-pending-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `bounded-pending-week-${crypto.randomUUID()}`;
    try {
      const activityDays = [
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
        "2026-09-17",
        "2026-09-18",
        "2026-09-19",
        "2026-09-20",
      ];
      for (const [index, activityDay] of activityDays.entries()) {
        const result = await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            { period_key: periodKey, activity_day: activityDay },
            `${activityDay}T16:00:00.000Z`,
          ),
          key(),
        );
        if (index < 5) {
          assert.equal(result.status, "processed");
        } else {
          assert.deepEqual(result, {
            status: "rejected",
            error: "daily_log_period_limit_exceeded",
          });
        }
      }

      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "term-bounded-pending",
            term_start_day: "2026-09-14",
            term_end_day: "2026-12-31",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 1,
          },
          "2026-09-21T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(configured.status, "processed");
      assert.deepEqual(
        configured.status === "processed"
          ? configured.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [10, 10, 10, 10, 10, 75],
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const [settlementCount] = await getDb()
        .select({ value: sql<number>`count(*)::int` })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(
              learnerFacts.eventType,
              "internal.daily_log.reward_settlement",
            ),
          ),
        );
      assert.equal(settlementCount.value, 5);
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-21T13:00:00.000Z") },
      );
      assert.equal(snapshot.companion.xp, 125);
      assert.deepEqual(
        snapshot.roadmap.weeks[0]?.achievements.find(
          (achievement) => achievement.title === "Weekly Rhythm",
        )?.progress,
        { current: 4, target: 4, label: "4 of 4 eligible days" },
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "does not repay an unmarked pre-rollout daily fact at first configuration",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `legacy-unmarked-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `legacy-unmarked-week-${crypto.randomUUID()}`;
    const configurationKey = key();
    try {
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const occurredAt = new Date("2026-09-14T16:00:00.000Z");
      const metadata = {
        period_key: periodKey,
        activity_day: "2026-09-14",
      };
      const [sourceEvent] = await getDb()
        .insert(events)
        .values({
          integrationId: integration.id,
          learnerId,
          idempotencyKey: key(),
          eventType: "daily_log.completed",
          occurredAt,
          metadata,
        })
        .returning({ id: events.id });
      await getDb().insert(learnerFacts).values({
        integrationId: integration.id,
        learnerId,
        sourceEventId: sourceEvent.id,
        eventType: "daily_log.completed",
        semanticKey: "2026-09-14",
        periodKey,
        occurredAt,
        metadata,
      });
      // This is the state produced by the pre-remediation ingest path: the fact
      // has already paid daily XP, but has neither pending nor settlement marker.
      await getDb().insert(economy).values({
        learnerId,
        xp: 10,
        xpLifetime: 10,
        streakCurrent: 1,
        streakLastDay: "2026-09-14",
        lastEventAt: occurredAt,
      });

      const configuration = event(
        "daily_log_week.configured",
        {
          period_key: periodKey,
          config_version: 1,
          period_status: "open",
          eligible_days: 1,
          term_token: "term-legacy-unmarked",
          term_start_day: "2026-09-14",
          term_end_day: "2026-12-31",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_start_day: "2026-09-14",
          week_index: 1,
        },
        "2026-09-15T12:00:00.000Z",
      );
      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        configuration,
        configurationKey,
      );
      assert.equal(configured.status, "processed");
      assert.deepEqual(
        configured.status === "processed"
          ? configured.result.mutations
              .filter((mutation) => mutation.type === "XP_GRANT")
              .map((mutation) => mutation.amount)
          : [],
        [75],
      );
      assert.deepEqual(
        configured.status === "processed"
          ? configured.result.mutations.filter(
              (mutation) => mutation.type === "WORLD_UNLOCK",
            )
          : [],
        [{ type: "WORLD_UNLOCK", asset_ref_id: "world-study-bird-v1" }],
      );

      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T13:00:00.000Z") },
      );
      assert.equal(snapshot.companion.xp, 85);
      assert.equal(snapshot.companion.streak, 1);
      assert.deepEqual(
        snapshot.collection?.items.map((item) => item.id),
        ["world-study-bird-v1"],
      );

      assert.equal(
        (
          await processEventInDb(
            integration.id,
            externalLearnerId,
            configuration,
            configurationKey,
          )
        ).status,
        "duplicate",
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...configuration.metadata, config_version: 2 },
          "2026-09-15T13:00:00.000Z",
        ),
        key(),
      );
      const afterRevision = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T14:00:00.000Z") },
      );
      assert.equal(afterRevision.companion.xp, 85);
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

      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-10-15T12:00:00.000Z") },
      );
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
  "places a late-joining learner at the producer's authoritative term week",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `late-join-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `late-join-week-${crypto.randomUUID()}`;
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-10-12",
            week_index: 7,
          },
          "2026-10-12T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-10-15T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 7);
      assert.equal(snapshot.roadmap.weeks[0].achievements.length, 0);
      assert.ok(
        snapshot.roadmap.weeks[6].achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps v1 calendar periods visible while upgrading a term in place",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `v1-calendar-upgrade-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const periodKey = `v1-week-3-${crypto.randomUUID()}`;
    const baseCalendar = {
      period_key: periodKey,
      period_status: "open" as const,
      eligible_days: 1,
      term_token: "fall-2026",
      term_start_day: "2026-08-31",
      term_end_day: "2026-12-18",
      term_timezone: "America/Toronto",
      week_index: 3,
    };
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...baseCalendar, config_version: 1 },
          "2026-09-14T12:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-14" },
          "2026-09-14T17:00:00.000Z",
        ),
        key(),
      );

      const upgraded = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            ...baseCalendar,
            config_version: 2,
            term_week_count: 16,
            week_start_day: "2026-09-14",
          },
          "2026-09-15T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(upgraded.status, "processed");

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.weeks.length, 16);
      assert.equal(snapshot.roadmap.currentWeek, 3);
      assert.ok(
        snapshot.roadmap.weeks[2]?.achievements.some(
          (achievement) =>
            achievement.title === "Weekly Rhythm" &&
            achievement.status === "earned",
        ),
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps the schema-v1 Week 1 placeholder before its first local start",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `before-first-week-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `delayed-week-one-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 12,
            week_start_day: "2026-09-07",
            week_index: 1,
          },
          "2026-08-30T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      for (const asOf of [
        "2026-08-01T12:00:00.000Z",
        "2026-09-01T12:00:00.000Z",
      ]) {
        const snapshot = await loadLearnerSnapshot(
          integration.id,
          learnerId,
          getDb(),
          { asOf: new Date(asOf) },
        );
        assert.equal(snapshot.roadmap.currentWeek, 1);
        assert.equal(snapshot.roadmap.weeks[0]?.status, "current");
        assert.ok(snapshot.roadmap.weeks.slice(1).every(
          (week) => week.status === "future",
        ));
      }

      const opened = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-07T04:00:00.000Z") },
      );
      assert.equal(opened.roadmap.currentWeek, 1);
      assert.equal(opened.roadmap.weeks[0]?.status, "current");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "accepts delayed v1 calendar facts after an adaptive 16-week fact",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `delayed-v1-calendar-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const weekThreeKey = `adaptive-week-3-${crypto.randomUUID()}`;
    const sharedTerm = {
      term_token: "fall-2026",
      term_start_day: "2026-08-31",
      term_end_day: "2026-12-18",
      term_timezone: "America/Toronto",
    };
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: weekThreeKey,
            config_version: 2,
            period_status: "open",
            eligible_days: 1,
            ...sharedTerm,
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 3,
          },
          "2026-09-15T12:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: weekThreeKey, activity_day: "2026-09-14" },
          "2026-09-14T13:00:00.000Z",
        ),
        key(),
      );

      const delayedSamePeriod = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: weekThreeKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 1,
            ...sharedTerm,
            week_index: 3,
          },
          "2026-09-14T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(delayedSamePeriod.status, "processed");

      const delayedDistinctPeriod = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `v1-week-4-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            ...sharedTerm,
            week_index: 4,
          },
          "2026-09-21T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(delayedDistinctPeriod.status, "processed");

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-22T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.weeks.length, 16);
      assert.equal(snapshot.roadmap.currentWeek, 4);
      assert.ok(
        snapshot.roadmap.weeks[2]?.achievements.some(
          (achievement) =>
            achievement.title === "Weekly Rhythm" &&
            achievement.status === "earned",
        ),
      );
      assert.ok(
        snapshot.roadmap.weeks[3]?.achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps a preconfigured later week future until its authoritative local start",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `future-week-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const calendar = {
      config_version: 1,
      period_status: "open" as const,
      eligible_days: 5,
      term_token: "fall-2026",
      term_start_day: "2026-08-31",
      term_end_day: "2026-12-18",
      term_timezone: "America/Toronto",
      term_week_count: 12,
    };
    try {
      for (const week of [
        // The two-week gap proves currentness does not assume consecutive
        // seven-day periods or use configuration delivery time. Sending Week
        // 2 first also proves delivery order is irrelevant.
        { index: 2, start: "2026-09-14" },
        { index: 1, start: "2026-08-31" },
      ]) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              ...calendar,
              period_key: `future-week-${week.index}-${crypto.randomUUID()}`,
              week_start_day: week.start,
              week_index: week.index,
            },
            "2026-08-30T12:00:00.000Z",
          ),
          key(),
        );
      }

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const before = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-14T03:59:59.000Z") },
      );
      const at = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-14T04:00:00.000Z") },
      );

      assert.equal(before.roadmap.currentWeek, 1);
      assert.equal(before.roadmap.weeks.length, 12);
      assert.equal(before.roadmap.weeks[1]?.status, "future");
      assert.ok(
        before.roadmap.weeks[1]?.achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
      assert.equal(at.roadmap.currentWeek, 2);
      assert.equal(at.roadmap.weeks[1]?.status, "current");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "sizes the roadmap to the producer's authoritative term week count",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });

    for (const termWeekCount of [6, 12, 24]) {
      const externalLearnerId = `term-length-${termWeekCount}-${crypto.randomUUID()}`;
      try {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `week-${termWeekCount}-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 5,
              term_token: `term-${termWeekCount}`,
              term_start_day: "2026-01-01",
              term_end_day: "2026-12-31",
              term_timezone: "America/Toronto",
              term_week_count: termWeekCount,
              week_start_day: "2026-06-01",
              week_index: termWeekCount,
            },
            "2026-06-01T12:00:00.000Z",
          ),
          key(),
        );

        const learnerId = await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        );
        const snapshot = await loadLearnerSnapshot(
          integration.id,
          learnerId,
          getDb(),
          { asOf: new Date("2026-06-01T12:00:00.000Z") },
        );
        assert.equal(snapshot.roadmap.weeks.length, termWeekCount);
        assert.equal(snapshot.roadmap.currentWeek, termWeekCount);
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "places legacy daily-log periods by local activity day during calendar rollout",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `local-legacy-periods-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const legacyWeeks = [
      { day: "2026-08-31", periodKey: `legacy-week-1-${crypto.randomUUID()}` },
      { day: "2026-09-07", periodKey: `legacy-week-2-${crypto.randomUUID()}` },
    ];
    try {
      for (const legacyWeek of legacyWeeks) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: legacyWeek.periodKey,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
            },
            `${legacyWeek.day}T12:00:00.000Z`,
          ),
          key(),
        );
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log.completed",
            {
              period_key: legacyWeek.periodKey,
              activity_day: legacyWeek.day,
            },
            `${legacyWeek.day}T17:00:00.000Z`,
          ),
          key(),
        );
      }

      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `authoritative-week-3-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 1,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-14",
            week_index: 3,
          },
          "2026-09-14T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-15T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 3);
      for (const weekIndex of [0, 1]) {
        assert.ok(
          snapshot.roadmap.weeks[weekIndex].achievements.some(
            (achievement) =>
              achievement.title === "Weekly Rhythm" &&
              achievement.status === "earned",
          ),
        );
      }
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "rejects a second period that claims an occupied term week",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `calendar-conflict-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const calendar = {
      config_version: 1,
      period_status: "open",
      eligible_days: 5,
      term_token: "fall-2026",
      term_start_day: "2026-08-31",
      term_end_day: "2026-12-18",
      term_timezone: "America/Toronto",
      term_week_count: 16,
      week_start_day: "2026-10-12",
      week_index: 7,
    };
    try {
      const first = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...calendar, period_key: `period-a-${crypto.randomUUID()}` },
          "2026-10-12T12:00:00.000Z",
        ),
        key(),
      );
      assert.equal(first.status, "processed");

      const second = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          { ...calendar, period_key: `period-b-${crypto.randomUUID()}` },
          "2026-10-12T13:00:00.000Z",
        ),
        key(),
      );
      assert.deepEqual(second, {
        status: "rejected",
        error: "conflicting_period_calendar",
      });

      const changedLength = await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            ...calendar,
            period_key: `period-c-${crypto.randomUUID()}`,
            term_week_count: 12,
            week_index: 8,
          },
          "2026-10-12T14:00:00.000Z",
        ),
        key(),
      );
      assert.deepEqual(changedLength, {
        status: "rejected",
        error: "conflicting_period_calendar",
      });
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps authoritative periods placed when configuration anchors fall outside the term",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const cases = [
      {
        label: "pre-start",
        occurredAt: "2026-08-30T23:00:00.000Z",
        weekStartDay: "2026-08-31",
        weekIndex: 1,
      },
      {
        label: "post-end-backfill",
        occurredAt: "2026-12-20T12:00:00.000Z",
        weekStartDay: "2026-12-14",
        weekIndex: 16,
      },
    ];

    for (const scenario of cases) {
      const externalLearnerId = `${scenario.label}-${crypto.randomUUID()}`;
      try {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `${scenario.label}-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 5,
              term_token: "fall-2026",
              term_start_day: "2026-08-31",
              term_end_day: "2026-12-18",
              term_timezone: "America/Toronto",
              term_week_count: 16,
              week_start_day: scenario.weekStartDay,
              week_index: scenario.weekIndex,
            },
            scenario.occurredAt,
          ),
          key(),
        );

        const learnerId = await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        );
        const snapshot = await loadLearnerSnapshot(
          integration.id,
          learnerId,
          getDb(),
          { asOf: new Date("2026-10-15T12:00:00.000Z") },
        );
        assert.equal(snapshot.roadmap.currentWeek, 1);
        assert.ok(
          snapshot.roadmap.weeks[scenario.weekIndex - 1].achievements.some(
            (achievement) => achievement.title === "Weekly Rhythm",
          ),
          scenario.label,
        );
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "excludes a backfilled prior-term calendar period from the current term",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `cross-term-backfill-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `spring-backfill-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "spring-2026",
            term_start_day: "2026-01-05",
            term_end_day: "2026-04-24",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-04-20",
            week_index: 16,
          },
          // The backfill is delivered during the later term. Its anchor must
          // not make this calendar-bearing period look like a legacy fall week.
          "2026-09-07T12:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `fall-week-2-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-09-07",
            week_index: 2,
          },
          "2026-09-07T13:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-10T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 2);
      assert.equal(
        snapshot.roadmap.weeks
          .flatMap((week) => week.achievements)
          .filter((achievement) => achievement.title === "Weekly Rhythm").length,
        1,
      );
      assert.ok(
        snapshot.roadmap.weeks[1].achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps the active term selected when a future term is preconfigured",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `future-term-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `fall-week-10-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-11-02",
            week_index: 10,
          },
          "2026-11-02T12:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `spring-week-1-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "spring-2027",
            term_start_day: "2027-01-04",
            term_end_day: "2027-04-23",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2027-01-04",
            week_index: 1,
          },
          "2026-11-03T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-11-15T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 10);
      assert.equal(
        snapshot.roadmap.weeks
          .flatMap((week) => week.achievements)
          .filter((achievement) => achievement.title === "Weekly Rhythm").length,
        1,
      );
      assert.ok(
        snapshot.roadmap.weeks[9].achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "changes terms at the authoritative Toronto start and end midnights",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const boundaries = [
      {
        label: "summer-to-fall",
        previous: {
          token: "summer-2026",
          start: "2026-05-11",
          end: "2026-08-30",
        },
        next: {
          token: "fall-2026",
          start: "2026-08-31",
          end: "2026-12-18",
        },
        before: "2026-08-31T03:59:59.000Z",
        at: "2026-08-31T04:00:00.000Z",
      },
      {
        label: "fall-to-winter",
        previous: {
          token: "fall-2026",
          start: "2026-08-31",
          end: "2026-12-18",
        },
        next: {
          token: "winter-2026",
          start: "2026-12-19",
          end: "2027-04-09",
        },
        before: "2026-12-19T04:59:59.000Z",
        at: "2026-12-19T05:00:00.000Z",
      },
    ];

    for (const boundary of boundaries) {
      const externalLearnerId = `${boundary.label}-${crypto.randomUUID()}`;
      try {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `${boundary.previous.token}-week-16-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 5,
              term_token: boundary.previous.token,
              term_start_day: boundary.previous.start,
              term_end_day: boundary.previous.end,
              term_timezone: "America/Toronto",
              term_week_count: 16,
              week_start_day: boundary.previous.end,
              week_index: 16,
            },
            boundary.before,
          ),
          key(),
        );
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `${boundary.next.token}-week-1-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 5,
              term_token: boundary.next.token,
              term_start_day: boundary.next.start,
              term_end_day: boundary.next.end,
              term_timezone: "America/Toronto",
              term_week_count: 16,
              week_start_day: boundary.next.start,
              week_index: 1,
            },
            boundary.before,
          ),
          key(),
        );

        const learnerId = await getOrCreateLearnerIdentity(
          getDb(),
          integration.id,
          externalLearnerId,
        );
        const before = await loadLearnerSnapshot(
          integration.id,
          learnerId,
          getDb(),
          { asOf: new Date(boundary.before) },
        );
        const at = await loadLearnerSnapshot(
          integration.id,
          learnerId,
          getDb(),
          { asOf: new Date(boundary.at) },
        );
        assert.equal(before.roadmap.currentWeek, 16, boundary.label);
        assert.equal(at.roadmap.currentWeek, 1, boundary.label);
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "selects a new authoritative term after sixteen historical periods",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `returning-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      for (let index = 0; index < 16; index += 1) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `spring-${index}-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
            },
            new Date(Date.UTC(2026, 0, 5 + index * 7, 12)).toISOString(),
          ),
          key(),
        );
      }
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `fall-week-7-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-10-12",
            week_index: 7,
          },
          "2026-10-12T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-10-15T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 7);
      assert.ok(
        snapshot.roadmap.weeks[6].achievements.some(
          (achievement) => achievement.title === "Weekly Rhythm",
        ),
      );
      assert.equal(
        snapshot.roadmap.weeks
          .flatMap((week) => week.achievements)
          .filter((achievement) => achievement.title === "Weekly Rhythm").length,
        1,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "keeps legacy periods in their term when calendar fields roll out midterm",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `mixed-rollout-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      for (let week = 1; week <= 6; week += 1) {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          event(
            "daily_log_week.configured",
            {
              period_key: `mixed-week-${week}-${crypto.randomUUID()}`,
              config_version: 1,
              period_status: "open",
              eligible_days: 1,
            },
            new Date(Date.UTC(2026, 7, 31 + (week - 1) * 7, 12)).toISOString(),
          ),
          key(),
        );
      }
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `mixed-week-7-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: "fall-2026",
            term_start_day: "2026-08-31",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_start_day: "2026-10-12",
            week_index: 7,
          },
          "2026-10-12T12:00:00.000Z",
        ),
        key(),
      );
      // A later legacy fact must not unset the latest complete calendar group.
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log_week.configured",
          {
            period_key: `mixed-week-8-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 1,
          },
          "2026-10-19T12:00:00.000Z",
        ),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-10-20T12:00:00.000Z") },
      );
      assert.equal(snapshot.roadmap.currentWeek, 8);
      for (let week = 1; week <= 8; week += 1) {
        assert.ok(
          snapshot.roadmap.weeks[week - 1].achievements.some(
            (achievement) => achievement.title === "Weekly Rhythm",
          ),
        );
      }
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
        {
          afterScopeVerified: async () => {
            markScopeVerified();
            await continueRead;
          },
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
