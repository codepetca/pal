import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import type { PalRewardNotice } from "@codepet/pal-widget";
import {
  achievementInstances,
  economy,
  getDb,
  learnerRewardGrants,
  storyPlanChapters,
  storyPlans,
} from "@pal/db";
import {
  STORY_REGISTRY,
  storyForTermStartDay,
} from "@/lib/story-catalog";
import {
  projectStoryFixture,
  StoryFixtureLedger,
} from "@/lib/story-fixture";
import {
  projectStoryProgression,
  projectUnseenGrantRewards,
  type ProjectableRewardGrant,
} from "@/lib/story-projector";
import { loadPersistedStoryPlan, type PersistedStoryPlan } from "@/lib/story-plan";
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
import { runStoryGrantWorker } from "@/lib/story-grant-worker";

const secret = "story-system-test-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = secret;

test("client dependency graphs cannot reach server story authority", () => {
  const sourceRoot = path.resolve(process.cwd(), "src");
  const forbidden = new Set([
    "lib/story-catalog.ts",
    "lib/story-fixture.ts",
    "lib/story-plan.ts",
    "lib/story-projector.ts",
    "lib/reward-grants.ts",
  ].map((file) => path.join(sourceRoot, file)));
  const sourceFiles: string[] = [];
  const visitDirectory = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(candidate);
      else if (/\.(?:ts|tsx|mts)$/.test(entry.name)) sourceFiles.push(candidate);
    }
  };
  visitDirectory(sourceRoot);
  const resolveImport = (from: string, specifier: string): string | undefined => {
    const stem = specifier.startsWith("@/")
      ? path.join(sourceRoot, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(from), specifier)
        : undefined;
    if (!stem) return undefined;
    return [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, path.join(stem, "index.ts"), path.join(stem, "index.tsx")]
      .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  };
  const dependencies = new Map<string, string[]>();
  for (const file of sourceFiles) {
    const text = fs.readFileSync(file, "utf8");
    const imports = [...text.matchAll(/(?:import|export)\s+(?!type\b)[\s\S]*?\sfrom\s+["']([^"']+)["']|import\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)]
      .flatMap((match) => {
        const resolved = resolveImport(file, match[1] ?? match[2] ?? match[3]);
        return resolved ? [resolved] : [];
      });
    dependencies.set(file, imports);
  }
  const clientRoots = sourceFiles.filter((file) => /^\s*["']use client["'];/m.test(fs.readFileSync(file, "utf8")));
  for (const root of clientRoots) {
    const pending = [root];
    const seen = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      assert.equal(
        forbidden.has(file),
        false,
        `${path.relative(sourceRoot, root)} reaches server story module ${path.relative(sourceRoot, file)}`,
      );
      pending.push(...(dependencies.get(file) ?? []));
    }
  }
});

function persistedPlan(totalPeriods = 6): PersistedStoryPlan {
  const reference = storyForTermStartDay("2026-08-31");
  const plan = STORY_REGISTRY.createPlan(totalPeriods, reference);
  return {
    ...plan,
    id: "plan-current",
    learnerId: "learner-current",
    termKey: "term-current",
    termStartDay: "2026-08-31",
    chapters: plan.chapters.map((chapter) => ({
      ...chapter,
      assignmentId: `assignment-${chapter.roadmapWeek}`,
      periodKey: `period-${chapter.roadmapWeek}`,
    })),
  };
}

function grant(
  order: number,
  values: Partial<ProjectableRewardGrant>,
): ProjectableRewardGrant {
  return {
    id: `grant-${order}`,
    grantOrder: BigInt(order),
    learnerId: "learner-current",
    kind: "behavior_title",
    sourceFactId: `fact-${order}`,
    storyPlanId: null,
    storyPlanChapterId: null,
    behaviorTitleId: "on-time-pro",
    seenAt: null,
    ...values,
  };
}

test("all supported plans are deterministic, complete, and deeply immutable", () => {
  const reference = storyForTermStartDay("2026-08-31");
  for (let weeks = 6; weeks <= 24; weeks += 1) {
    const left = STORY_REGISTRY.createPlan(weeks, reference);
    const right = STORY_REGISTRY.createPlan(weeks, reference);
    assert.equal(left.chapters.length, weeks);
    assert.deepEqual(
      left.chapters.map((chapter) => [chapter.roadmapWeek, chapter.id]),
      right.chapters.map((chapter) => [chapter.roadmapWeek, chapter.id]),
    );
    assert.ok(Object.isFrozen(left));
    assert.ok(Object.isFrozen(left.chapters));
    assert.ok(left.chapters.every((chapter) => Object.isFrozen(chapter) && Object.isFrozen(chapter.collectible)));
  }
  const catalog = STORY_REGISTRY.requireCatalog(reference);
  assert.ok(Object.isFrozen(catalog));
  assert.throws(() => {
    (catalog.chapters[0] as { id: string }).id = "changed";
  }, TypeError);
});

test("projector keeps prior-term titles without unlocking current-term collectibles", () => {
  const plan = persistedPlan();
  const priorPlan: PersistedStoryPlan = {
    ...plan,
    id: "plan-prior",
    termKey: "term-prior",
    chapters: plan.chapters.map((chapter) => ({
      ...chapter,
      assignmentId: `prior-${chapter.assignmentId}`,
    })),
  };
  const priorTermGrant = grant(1, {
    kind: "story_chapter",
    storyPlanId: priorPlan.id,
    storyPlanChapterId: priorPlan.chapters[0]?.assignmentId,
    behaviorTitleId: null,
  });
  const plans = new Map([
    [plan.id, plan],
    [priorPlan.id, priorPlan],
  ]);
  const projection = projectStoryProgression(plan, [priorTermGrant], plans);
  assert.equal(projection.collectibles[0]?.status, "next");
  assert.equal(projection.currentTitle, "Gentle Keeper");
  assert.equal(projection.titles.some((title) => title.id === "gentle-keeper"), true);
  assert.equal(projectUnseenGrantRewards([priorTermGrant], plans).length, 1);
  const raw = JSON.stringify(projection);
  assert.equal(raw.includes(plan.storyId), false);
  for (const chapter of plan.chapters) {
    assert.equal(raw.includes(chapter.revealHeadline), false);
    assert.equal(raw.includes(chapter.storyCopy), false);
    assert.equal(raw.includes(chapter.collectible.assetUrl), false);
    assert.equal(raw.includes(chapter.collectible.title), false);
  }
});

test("server fixture replays grants, titles, and acknowledgement without future content", async () => {
  const rhythmCommands = ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16"].map(
    (activityDay, index) => ({
      type: "action" as const,
      id: `daily-${index + 1}`,
      action: "daily-log-completed" as const,
      context: { activityDay },
    }),
  );
  const beforeDue = await projectStoryFixture({ termWeeks: 16, commands: rhythmCommands });
  assert.equal(beforeDue.progression?.collectibles[0]?.status, "next");
  const commands = [
    ...rhythmCommands,
    { type: "action" as const, id: "advance-week-one", action: "advance-week" as const },
  ];
  const locked = await projectStoryFixture({ termWeeks: 16, commands: [] });
  const lockedRaw = JSON.stringify(locked);
  assert.equal(lockedRaw.includes("pips-first-recipe"), false);
  assert.equal(/\bPip\b/.test(lockedRaw), false);

  const earned = await projectStoryFixture({ termWeeks: 16, commands });
  assert.equal(earned.progression?.collectibles[0]?.status, "earned");
  assert.equal(
    earned.progression?.collectibles[0]?.status === "earned"
      ? earned.progression.collectibles[0].finish
      : undefined,
    "color",
  );
  assert.equal(
    earned.progression?.titles.some((title) => title.id === "rhythm-builder"),
    true,
  );
  const storyReward = earned.rewards.find((reward) => reward.kind === "story");
  assert.ok(storyReward);

  const afterBreak = await projectStoryFixture({
    termWeeks: 16,
    commands: [
      ...commands,
      {
        type: "action",
        id: "daily-break",
        action: "daily-log-completed",
        context: { activityDay: "2026-04-21" },
      },
    ],
  });
  assert.equal(afterBreak.companion.streak, 1);
  assert.equal(
    afterBreak.progression?.titles.some((title) => title.id === "rhythm-builder"),
    true,
  );

  const laterBehavior = await projectStoryFixture({
    termWeeks: 16,
    commands: [
      ...commands,
      {
        type: "action",
        id: "on-time-later",
        action: "on-time-finish",
        context: { itemToken: "later-item" },
      },
    ],
  });
  assert.equal(laterBehavior.progression?.currentTitle, "On-Time Pro");

  const acknowledged = await projectStoryFixture({
    termWeeks: 16,
    commands: [...commands, { type: "acknowledge", rewardId: storyReward.id }],
  });
  assert.equal(
    acknowledged.rewards.some((reward) => reward.id === storyReward.id),
    false,
  );
  assert.equal(acknowledged.progression?.collectibles[0]?.status, "earned");
});

test("durable action order selects titles and a story title wins only its same-action tie", () => {
  const plan = persistedPlan();
  const story = grant(1, {
    kind: "story_chapter",
    sourceFactId: "fact-shared",
    storyPlanId: plan.id,
    storyPlanChapterId: plan.chapters[0]?.assignmentId,
    behaviorTitleId: null,
  });
  const sameActionBehavior = grant(2, {
    sourceFactId: "fact-shared",
    behaviorTitleId: "rhythm-builder",
  });
  assert.equal(
    projectStoryProgression(plan, [story, sameActionBehavior]).currentTitle,
    "Gentle Keeper",
  );
  const laterBehavior = grant(3, {
    sourceFactId: "fact-later",
    behaviorTitleId: "on-time-pro",
  });
  assert.equal(
    projectStoryProgression(plan, [story, sameActionBehavior, laterBehavior]).currentTitle,
    "On-Time Pro",
  );
});

test("fixture uses the production projector and seen state never removes ownership", () => {
  const plan = persistedPlan();
  const fixture = new StoryFixtureLedger(plan);
  fixture.grantBehaviorTitle("rhythm-builder", "fact-shared");
  fixture.grantStoryChapter(plan.chapters[0]!.assignmentId, "fact-shared");
  fixture.grantStoryChapter(plan.chapters[0]!.assignmentId, "fact-retry");
  assert.equal(fixture.grants().length, 2);
  assert.deepEqual(fixture.progression(), projectStoryProgression(plan, fixture.grants()));
  assert.equal(fixture.progression().currentTitle, "Gentle Keeper");
  const storyReward = fixture.rewards().find((reward) => reward.kind === "story");
  assert.ok(storyReward);
  fixture.markSeen(storyReward.id);
  assert.equal(fixture.rewards().some((reward) => reward.id === storyReward.id), false);
  assert.equal(fixture.grants().length, 2);
  assert.equal(fixture.progression().collectibles[0]?.status, "earned");
});

function configuredWeek(periodKey: string, externalTerm = "story-term") {
  return {
    event_type: "daily_log_week.configured",
    occurred_at: "2026-08-31T12:00:00.000Z",
    metadata: {
      period_key: periodKey,
      config_version: 1,
      period_status: "open",
      eligible_days: 1,
      term_token: externalTerm,
      term_start_day: "2026-08-31",
      term_end_day: "2026-10-12",
      term_timezone: "America/Toronto",
      term_week_count: 6,
      week_start_day: "2026-08-31",
      week_index: 1,
    },
  };
}

function dailyLog(periodKey: string) {
  return {
    event_type: "daily_log.completed",
    occurred_at: "2026-08-31T15:00:00.000Z",
    metadata: { period_key: periodKey, activity_day: "2026-08-31" },
  };
}

function dailyLogOn(periodKey: string, activityDay: string) {
  return {
    event_type: "daily_log.completed",
    occurred_at: `${activityDay}T15:00:00.000Z`,
    metadata: { period_key: periodKey, activity_day: activityDay },
  };
}

test("two learners receive the same persisted sequence for the same term boundary", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const learners = [`deterministic-a-${crypto.randomUUID()}`, `deterministic-b-${crypto.randomUUID()}`];
  try {
    for (const externalLearnerId of learners) {
      await processEventInDb(integration.id, externalLearnerId, configuredWeek(`period-${crypto.randomUUID()}`), crypto.randomUUID());
    }
    const sequences = [];
    for (const externalLearnerId of learners) {
      const learnerId = await getOrCreateLearnerIdentity(getDb(), integration.id, externalLearnerId);
      const [plan] = await getDb().select().from(storyPlans).where(eq(storyPlans.learnerId, learnerId));
      assert.equal(plan?.termStartDay, "2026-08-31");
      sequences.push((await getDb().select().from(storyPlanChapters).where(eq(storyPlanChapters.storyPlanId, plan!.id)).orderBy(asc(storyPlanChapters.periodNumber))).map((row) => row.chapterId));
    }
    assert.deepEqual(sequences[0], sequences[1]);
  } finally {
    await Promise.all(learners.map((externalLearnerId) => resetLearnerInDb(integration.id, externalLearnerId)));
  }
});

test("a preconfigured future week cannot earn or reveal its story chapter", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `future-story-${crypto.randomUUID()}`;
  const periodKey = `future-period-${crypto.randomUUID()}`;
  const configuration = configuredWeek(periodKey, `future-term-${crypto.randomUUID()}`);
  configuration.metadata.week_index = 6;
  configuration.metadata.week_start_day = "2026-10-05";
  try {
    const pending = await processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLog(periodKey),
      crypto.randomUUID(),
    );
    assert.equal(pending.status, "processed");

    const configured = await processEventInDb(
      integration.id,
      externalLearnerId,
      configuration,
      crypto.randomUUID(),
    );
    assert.equal(configured.status, "processed");

    const early = await processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLogOn(periodKey, "2026-09-01"),
      crypto.randomUUID(),
    );
    assert.deepEqual(early, {
      status: "rejected",
      error: "inconsistent_activity_day",
    });

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    const grants = await getDb()
      .select()
      .from(learnerRewardGrants)
      .where(eq(learnerRewardGrants.learnerId, learnerId));
    assert.equal(grants.length, 0);

    const snapshot = await loadLearnerSnapshot(
      integration.id,
      learnerId,
      getDb(),
      { asOf: new Date("2026-09-01T12:00:00.000Z") },
    );
    assert.equal(snapshot.roadmap.currentWeek, 1);
    assert.equal(snapshot.roadmap.weeks[5]?.status, "future");
    assert.equal(snapshot.progression?.collectibles[5]?.status, "locked");
    const raw = JSON.stringify(snapshot);
    assert.equal(raw.includes("Meet Lumi"), false);
    assert.equal(raw.includes("/assets/pets/lumi-v1.png"), false);
    assert.equal(raw.includes("True Friend"), false);
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("a legacy calendar derives the same future-week grant boundary", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `future-legacy-story-${crypto.randomUUID()}`;
  const periodKey = `future-legacy-period-${crypto.randomUUID()}`;
  const configuration = configuredWeek(periodKey, `future-legacy-term-${crypto.randomUUID()}`);
  configuration.metadata.week_index = 6;
  configuration.metadata.term_end_day = "2026-12-18";
  delete (configuration.metadata as Record<string, unknown>).term_week_count;
  delete (configuration.metadata as Record<string, unknown>).week_start_day;
  try {
    const configured = await processEventInDb(
      integration.id,
      externalLearnerId,
      configuration,
      crypto.randomUUID(),
    );
    assert.equal(configured.status, "processed");

    const early = await processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLog(periodKey),
      crypto.randomUUID(),
    );
    assert.deepEqual(early, {
      status: "rejected",
      error: "inconsistent_activity_day",
    });

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    const grants = await getDb()
      .select()
      .from(learnerRewardGrants)
      .where(eq(learnerRewardGrants.learnerId, learnerId));
    assert.equal(grants.length, 0);
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("an adaptive revision cannot move an earned legacy week into the future", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `legacy-revision-story-${crypto.randomUUID()}`;
  const periodKey = `legacy-revision-period-${crypto.randomUUID()}`;
  const termKey = `legacy-revision-term-${crypto.randomUUID()}`;
  const legacy = configuredWeek(periodKey, termKey);
  legacy.occurred_at = "2026-08-03T12:00:00.000Z";
  legacy.metadata.term_start_day = "2026-06-29";
  // Leave one schedule-gap week so a different Monday remains structurally
  // valid and this test reaches the immutable-calendar conflict check.
  legacy.metadata.term_end_day = "2026-10-23";
  legacy.metadata.week_index = 6;
  delete (legacy.metadata as Record<string, unknown>).term_week_count;
  delete (legacy.metadata as Record<string, unknown>).week_start_day;
  try {
    assert.equal((await processEventInDb(
      integration.id,
      externalLearnerId,
      legacy,
      crypto.randomUUID(),
    )).status, "processed");
    assert.equal((await processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLogOn(periodKey, "2026-08-03"),
      crypto.randomUUID(),
    )).status, "processed");

    const adaptive = structuredClone(legacy);
    adaptive.occurred_at = "2026-08-04T12:00:00.000Z";
    adaptive.metadata.config_version = 2;
    adaptive.metadata.term_week_count = 16;
    adaptive.metadata.week_start_day = "2026-08-10";
    const moved = await processEventInDb(
      integration.id,
      externalLearnerId,
      adaptive,
      crypto.randomUUID(),
    );
    assert.deepEqual(moved, {
      status: "rejected",
      error: "conflicting_period_calendar",
    });

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    const snapshot = await loadLearnerSnapshot(
      integration.id,
      learnerId,
      getDb(),
      { asOf: new Date("2026-08-04T12:00:00.000Z") },
    );
    assert.notEqual(snapshot.roadmap.weeks[5]?.status, "future");
    assert.equal(snapshot.progression?.collectibles[5]?.status, "earned");
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("the first calendar-bearing revision quarantines calendarless pending facts", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  for (const adaptive of [false, true]) {
    const externalLearnerId = `calendar-rollout-${adaptive}-${crypto.randomUUID()}`;
    const periodKey = `calendar-rollout-period-${crypto.randomUUID()}`;
    const termKey = `calendar-rollout-term-${crypto.randomUUID()}`;
    try {
      assert.equal((await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLogOn(periodKey, "2026-08-03"),
        crypto.randomUUID(),
      )).status, "processed");
      assert.equal((await processEventInDb(
        integration.id,
        externalLearnerId,
        {
          event_type: "daily_log_week.configured",
          occurred_at: "2026-08-03T18:00:00.000Z",
          metadata: {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 0,
          },
        },
        crypto.randomUUID(),
      )).status, "processed");

      const calendarMetadata = {
        period_key: periodKey,
        config_version: 2,
        period_status: "open" as const,
        eligible_days: 1,
        term_token: termKey,
        term_start_day: "2026-07-27",
        term_end_day: "2026-11-20",
        term_timezone: "America/Toronto",
        week_index: 6,
        ...(adaptive
          ? { term_week_count: 16, week_start_day: "2026-08-31" }
          : {}),
      };
      const calendarRevision = await processEventInDb(
        integration.id,
        externalLearnerId,
        {
          event_type: "daily_log_week.configured",
          occurred_at: "2026-08-04T12:00:00.000Z",
          metadata: calendarMetadata,
        },
        crypto.randomUUID(),
      );
      assert.equal(calendarRevision.status, "processed");
      assert.deepEqual(
        calendarRevision.status === "processed"
          ? calendarRevision.result.mutations.filter(
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
      const grants = await getDb()
        .select()
        .from(learnerRewardGrants)
        .where(eq(learnerRewardGrants.learnerId, learnerId));
      assert.equal(grants.length, 0);

      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-08-04T12:00:00.000Z") },
      );
      const raw = JSON.stringify(snapshot);
      const planned = STORY_REGISTRY.createPlan(16, storyForTermStartDay("2026-07-27"));
      for (const chapter of planned.chapters) {
        assert.equal(raw.includes(chapter.storyCopy), false);
        assert.equal(raw.includes(chapter.collectible.assetUrl), false);
      }
      assert.equal(snapshot.rewards.some((reward) => reward.kind === "story"), false);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  }
});

test("legacy calendar facts pin the implied immutable 16-week plan", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `legacy-plan-${crypto.randomUUID()}`;
  const legacy = configuredWeek(`period-${crypto.randomUUID()}`, `legacy-term-${crypto.randomUUID()}`);
  legacy.metadata.term_end_day = "2026-12-18";
  delete (legacy.metadata as { term_week_count?: number }).term_week_count;
  try {
    await processEventInDb(integration.id, externalLearnerId, legacy, crypto.randomUUID());
    const learnerId = await getOrCreateLearnerIdentity(getDb(), integration.id, externalLearnerId);
    const [plan] = await getDb().select().from(storyPlans).where(eq(storyPlans.learnerId, learnerId));
    assert.equal(plan?.totalPeriods, 16);
    assert.equal((await getDb().select().from(storyPlanChapters).where(eq(storyPlanChapters.storyPlanId, plan!.id))).length, 16);
    const lockedSnapshot = await loadLearnerSnapshot(
      integration.id,
      learnerId,
      getDb(),
      { asOf: new Date("2026-09-01T12:00:00.000Z") },
    );
    const lockedRaw = JSON.stringify(lockedSnapshot);
    assert.equal(lockedRaw.includes(plan!.storyId), false);
    assert.equal(/\bPip\b/.test(lockedRaw), false);
    for (const chapter of STORY_REGISTRY.createPlan(16, {
      storyId: plan!.storyId,
      version: plan!.storyVersion,
    }).chapters) {
      assert.equal(lockedRaw.includes(chapter.storyCopy), false);
      assert.equal(lockedRaw.includes(chapter.collectible.assetUrl), false);
    }
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("a batched streak crossing grants Rhythm Builder before a later same-action break", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `batched-streak-${crypto.randomUUID()}`;
  const periodKey = `period-${crypto.randomUUID()}`;
  const configuration = configuredWeek(periodKey, `term-${crypto.randomUUID()}`);
  configuration.metadata.eligible_days = 5;
  try {
    for (const day of ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-04"]) {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        dailyLogOn(periodKey, day),
        crypto.randomUUID(),
      );
    }
    await processEventInDb(
      integration.id,
      externalLearnerId,
      configuration,
      crypto.randomUUID(),
    );

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    const [persistedEconomy] = await getDb()
      .select()
      .from(economy)
      .where(eq(economy.learnerId, learnerId));
    assert.equal(persistedEconomy?.streakCurrent, 1);
    const grants = await getDb()
      .select()
      .from(learnerRewardGrants)
      .where(
        and(
          eq(learnerRewardGrants.learnerId, learnerId),
          eq(learnerRewardGrants.behaviorTitleId, "rhythm-builder"),
        ),
      );
    assert.equal(grants.length, 1);
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("in-memory and persisted ledgers share story/title projection and streak loss cannot revoke", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `fixture-persisted-parity-${crypto.randomUUID()}`;
  const periodKey = `period-${crypto.randomUUID()}`;
  try {
    await processEventInDb(integration.id, externalLearnerId, configuredWeek(periodKey), crypto.randomUUID());
    const learnerId = await getOrCreateLearnerIdentity(getDb(), integration.id, externalLearnerId);
    await getDb().update(economy).set({
      streakCurrent: 2,
      streakLastDay: "2026-08-30",
    }).where(eq(economy.learnerId, learnerId));
    await processEventInDb(integration.id, externalLearnerId, dailyLog(periodKey), crypto.randomUUID());
    await runStoryGrantWorker({
      asOf: new Date("2026-09-05T12:00:00.000Z"),
      onlyLearnerIds: [learnerId],
    });

    const plan = await loadPersistedStoryPlan(getDb(), learnerId, "story-term");
    assert.ok(plan);
    const persistedGrants = await getDb().select().from(learnerRewardGrants)
      .where(eq(learnerRewardGrants.learnerId, learnerId))
      .orderBy(asc(learnerRewardGrants.grantOrder));
    assert.equal(persistedGrants.length, 2);
    assert.equal(new Set(persistedGrants.map((grant) => grant.sourceFactId)).size, 2);

    const fixture = new StoryFixtureLedger(plan);
    for (const persisted of persistedGrants) {
      if (persisted.kind === "story_chapter") {
        fixture.grantStoryChapter(
          persisted.storyPlanChapterId!,
          persisted.sourceFactId,
          "color",
        );
      } else {
        assert.equal(persisted.behaviorTitleId, "rhythm-builder");
        fixture.grantBehaviorTitle("rhythm-builder", persisted.sourceFactId);
      }
    }
    const snapshot = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-05T12:00:00Z") });
    assert.deepEqual(fixture.progression(), snapshot.progression);
    const displayReward = (reward: PalRewardNotice) => {
      assert.equal(reward.achievement, undefined);
      if (reward.achievement) throw new Error("Expected a grant reward");
      return {
        title: reward.title,
        description: reward.description,
        kind: reward.kind,
        collectibleTitle: reward.collectibleTitle,
        titleAward: reward.titleAward,
        titleRevealCopy: reward.titleRevealCopy,
        icon: reward.icon,
        assetUrl: reward.assetUrl,
      };
    };
    assert.deepEqual(
      fixture.rewards().map(displayReward),
      snapshot.rewards
        .filter((reward) => reward.achievement === undefined)
        .map(displayReward),
    );
    assert.equal(snapshot.progression?.currentTitle, "Gentle Keeper");

    await getDb().update(economy).set({ streakCurrent: 0, streakLastDay: null }).where(eq(economy.learnerId, learnerId));
    const afterBreak = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-05T12:00:00Z") });
    assert.equal(afterBreak.progression?.titles.some((title) => title.id === "rhythm-builder"), true);
    assert.equal(afterBreak.progression?.currentTitle, "Gentle Keeper");
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("a prior-term story title and unseen reveal remain durable in a later term", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `cross-term-story-title-${crypto.randomUUID()}`;
  const priorPeriodKey = `prior-period-${crypto.randomUUID()}`;
  const currentPeriodKey = `current-period-${crypto.randomUUID()}`;
  try {
    await processEventInDb(
      integration.id,
      externalLearnerId,
      configuredWeek(priorPeriodKey, `prior-term-${crypto.randomUUID()}`),
      crypto.randomUUID(),
    );
    await processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLog(priorPeriodKey),
      crypto.randomUUID(),
    );

    const currentTerm = configuredWeek(
      currentPeriodKey,
      `current-term-${crypto.randomUUID()}`,
    );
    currentTerm.occurred_at = "2026-10-19T12:00:00.000Z";
    currentTerm.metadata.term_start_day = "2026-10-19";
    currentTerm.metadata.term_end_day = "2026-11-30";
    currentTerm.metadata.week_start_day = "2026-10-19";
    await processEventInDb(
      integration.id,
      externalLearnerId,
      currentTerm,
      crypto.randomUUID(),
    );

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    await runStoryGrantWorker({
      asOf: new Date("2026-10-20T12:00:00.000Z"),
      onlyLearnerIds: [learnerId],
    });
    const snapshot = await loadLearnerSnapshot(
      integration.id,
      learnerId,
      getDb(),
      { asOf: new Date("2026-10-20T12:00:00.000Z") },
    );
    assert.equal(snapshot.progression?.collectibles[0]?.status, "next");
    assert.equal(snapshot.progression?.currentTitle, "Gentle Keeper");
    assert.equal(
      snapshot.progression?.titles.some((title) => title.id === "gentle-keeper"),
      true,
    );
    assert.equal(snapshot.rewards.some((reward) => reward.kind === "story"), true);
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("a calendarless behavior title is revealed and acknowledged without losing ownership", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `calendarless-title-${crypto.randomUUID()}`;
  try {
    const result = await processEventInDb(
      integration.id,
      externalLearnerId,
      {
        event_type: "learning_item.completed",
        occurred_at: "2026-08-01T12:00:00.000Z",
        metadata: {
          item_token: `calendarless-item-${crypto.randomUUID()}`,
          kind: "assignment",
          period_key: `calendarless-period-${crypto.randomUUID()}`,
          timing: "on_time",
        },
      },
      crypto.randomUUID(),
    );
    assert.equal(result.status, "processed");

    const learnerId = await getOrCreateLearnerIdentity(
      getDb(),
      integration.id,
      externalLearnerId,
    );
    const [grant] = await getDb()
      .select()
      .from(learnerRewardGrants)
      .where(and(
        eq(learnerRewardGrants.learnerId, learnerId),
        eq(learnerRewardGrants.behaviorTitleId, "on-time-pro"),
      ));
    assert.ok(grant);
    assert.equal(grant.seenAt, null);

    const snapshot = await loadLearnerSnapshot(integration.id, learnerId);
    assert.equal(snapshot.progression, undefined);
    const notice = snapshot.rewards.find((reward) => reward.id === grant.id);
    assert.ok(notice);
    assert.equal(notice.achievement, undefined);
    if (notice.achievement) throw new Error("Expected a title notice");
    assert.equal(notice.titleAward, "On-Time Pro");

    await acknowledgeLearnerReward(integration.id, learnerId, grant.id);
    const after = await loadLearnerSnapshot(integration.id, learnerId);
    assert.equal(after.rewards.some((reward) => reward.id === grant.id), false);
    const [owned] = await getDb()
      .select()
      .from(learnerRewardGrants)
      .where(eq(learnerRewardGrants.id, grant.id));
    assert.ok(owned?.seenAt);
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("scheduled ownership stays exact-once after Weekly Rhythm retries and acknowledgement", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `grant-retry-${crypto.randomUUID()}`;
  const periodKey = `period-${crypto.randomUUID()}`;
  try {
    await processEventInDb(integration.id, externalLearnerId, configuredWeek(periodKey), crypto.randomUUID());
    await Promise.allSettled(Array.from({ length: 4 }, () => processEventInDb(
      integration.id,
      externalLearnerId,
      dailyLog(periodKey),
      crypto.randomUUID(),
    )));
    const learnerId = await getOrCreateLearnerIdentity(getDb(), integration.id, externalLearnerId);
    await runStoryGrantWorker({
      asOf: new Date("2026-09-05T12:00:00.000Z"),
      onlyLearnerIds: [learnerId],
    });
    const storyGrants = await getDb().select().from(learnerRewardGrants).where(and(
      eq(learnerRewardGrants.learnerId, learnerId),
      eq(learnerRewardGrants.kind, "story_chapter"),
    ));
    assert.equal(storyGrants.length, 1);
    const snapshot = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-05T12:00:00Z") });
    const notice = snapshot.rewards.find((reward) => reward.kind === "story");
    assert.ok(notice);
    await acknowledgeLearnerReward(integration.id, learnerId, notice.id, getDb());
    const [owned] = await getDb().select().from(learnerRewardGrants).where(eq(learnerRewardGrants.id, notice.id));
    assert.ok(owned?.seenAt);
    const after = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-05T12:00:00Z") });
    assert.equal(after.rewards.some((reward) => reward.id === notice.id), false);
    assert.equal(after.progression?.collectibles[0]?.status, "earned");
    assert.equal(
      after.progression?.collectibles[0]?.status === "earned"
        ? after.progression.collectibles[0].finish
        : undefined,
      "color",
    );
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("historical achievement rows do not backfill grants or celebrations", { skip: !process.env.DATABASE_URL }, async () => {
  const integration = await resolveIntegration({ slug: "sandbox", name: "Sandbox", secret });
  const externalLearnerId = `no-backfill-${crypto.randomUUID()}`;
  const periodKey = `period-${crypto.randomUUID()}`;
  try {
    await processEventInDb(integration.id, externalLearnerId, configuredWeek(periodKey), crypto.randomUUID());
    const learnerId = await getOrCreateLearnerIdentity(getDb(), integration.id, externalLearnerId);
    await getDb().update(achievementInstances).set({ status: "earned" }).where(and(
      eq(achievementInstances.learnerId, learnerId),
      eq(achievementInstances.periodKey, periodKey),
    ));
    assert.equal((await getDb().select().from(learnerRewardGrants).where(eq(learnerRewardGrants.learnerId, learnerId))).length, 0);
    assert.equal(
      (await loadLearnerSnapshot(integration.id, learnerId)).rewards.some(
        (reward) => reward.achievement !== undefined,
      ),
      false,
    );
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});
