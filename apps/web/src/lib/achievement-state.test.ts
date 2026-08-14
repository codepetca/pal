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
      const snapshot = await loadLearnerSnapshot(integration.id, learnerId);
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
        weekIndex: 1,
      },
      {
        label: "post-end-backfill",
        occurredAt: "2026-12-20T12:00:00.000Z",
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
        assert.equal(snapshot.roadmap.currentWeek, scenario.weekIndex);
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
