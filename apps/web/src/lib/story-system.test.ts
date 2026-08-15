import assert from "node:assert/strict";
import { test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import {
  achievementInstances,
  getDb,
  learnerRewardGrants,
  storyPlanChapters,
  storyPlans,
} from "@pal/db";
import {
  STORY_REGISTRY,
  storyForTermStartDay,
} from "@/lib/story-catalog";
import { StoryFixtureLedger } from "@/lib/story-fixture";
import {
  projectStoryProgression,
  type ProjectableRewardGrant,
} from "@/lib/story-projector";
import type { PersistedStoryPlan } from "@/lib/story-plan";
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

const secret = "story-system-test-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = secret;

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
    grantOrder: order,
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

test("projector redacts every unearned story field and ignores prior-term grants", () => {
  const plan = persistedPlan();
  const priorTermGrant = grant(1, {
    kind: "story_chapter",
    storyPlanId: "plan-prior",
    storyPlanChapterId: plan.chapters[0]?.assignmentId,
    behaviorTitleId: null,
  });
  const projection = projectStoryProgression(plan, [priorTermGrant]);
  assert.equal(projection.collectibles[0]?.status, "next");
  const raw = JSON.stringify(projection);
  for (const chapter of plan.chapters) {
    assert.equal(raw.includes(chapter.revealHeadline), false);
    assert.equal(raw.includes(chapter.storyCopy), false);
    assert.equal(raw.includes(chapter.collectible.assetUrl), false);
    assert.equal(raw.includes(chapter.collectible.title), false);
  }
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

test("Weekly Rhythm grants exactly once under retries and acknowledgement preserves the grant", { skip: !process.env.DATABASE_URL }, async () => {
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
    const storyGrants = await getDb().select().from(learnerRewardGrants).where(and(
      eq(learnerRewardGrants.learnerId, learnerId),
      eq(learnerRewardGrants.kind, "story_chapter"),
    ));
    assert.equal(storyGrants.length, 1);
    const snapshot = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-01T12:00:00Z") });
    const notice = snapshot.rewards.find((reward) => reward.kind === "story");
    assert.ok(notice);
    await acknowledgeLearnerReward(integration.id, learnerId, notice.id, getDb());
    const [owned] = await getDb().select().from(learnerRewardGrants).where(eq(learnerRewardGrants.id, notice.id));
    assert.ok(owned?.seenAt);
    const after = await loadLearnerSnapshot(integration.id, learnerId, getDb(), { asOf: new Date("2026-09-01T12:00:00Z") });
    assert.equal(after.rewards.some((reward) => reward.id === notice.id), false);
    assert.equal(after.progression?.collectibles[0]?.status, "earned");
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});

test("historical achievement rows do not backfill reward grants", { skip: !process.env.DATABASE_URL }, async () => {
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
  } finally {
    await resetLearnerInDb(integration.id, externalLearnerId);
  }
});
