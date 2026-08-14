import assert from "node:assert/strict";
import { test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import {
  achievementInstances,
  getDb,
  rewardNotices,
  storyPlanChapters,
  storyPlans,
} from "@pal/db";
import { createPalStoryPlan } from "@codepet/pal-widget/progression";
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

const secret = "achievement-state-test-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = secret;

function key(): string {
  return `story-plan-test-${crypto.randomUUID()}`;
}

function event(
  eventType: string,
  metadata: Record<string, unknown>,
  occurredAt: string,
) {
  return { event_type: eventType, occurred_at: occurredAt, metadata };
}

function configuredWeek(
  periodKey: string,
  weekIndex: number,
  totalWeeks: number,
  eligibleDays = 2,
) {
  const weekStart = new Date(
    Date.parse("2026-08-31T00:00:00.000Z") +
      (weekIndex - 1) * 7 * 86_400_000,
  ).toISOString().slice(0, 10);
  return event(
    "daily_log_week.configured",
    {
      period_key: periodKey,
      config_version: 1,
      period_status: "open",
      eligible_days: eligibleDays,
      term_token: `story-term-${totalWeeks}`,
      term_start_day: "2026-08-31",
      term_end_day: "2027-03-01",
      term_timezone: "America/Toronto",
      term_week_count: totalWeeks,
      week_start_day: weekStart,
      week_index: weekIndex,
    },
    `${weekStart}T12:00:00.000Z`,
  );
}

test(
  "persists one complete deterministic plan and binds configured periods",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `persisted-story-${crypto.randomUUID()}`;
    const weekOneKey = `story-week-1-${crypto.randomUUID()}`;
    const weekTwoKey = `story-week-2-${crypto.randomUUID()}`;
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        configuredWeek(weekOneKey, 1, 12),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        configuredWeek(weekTwoKey, 2, 12),
        key(),
      );

      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const plans = await getDb()
        .select()
        .from(storyPlans)
        .where(eq(storyPlans.learnerId, learnerId));
      assert.equal(plans.length, 1);
      assert.equal(plans[0]?.termKey, "story-term-12");
      assert.equal(plans[0]?.totalPeriods, 12);

      const chapters = await getDb()
        .select()
        .from(storyPlanChapters)
        .where(eq(storyPlanChapters.storyPlanId, plans[0]!.id))
        .orderBy(asc(storyPlanChapters.periodNumber));
      const expected = createPalStoryPlan(12);
      assert.equal(chapters.length, 12);
      assert.deepEqual(
        chapters.map((chapter) => chapter.chapterId),
        expected.chapters.map((chapter) => chapter.id),
      );
      assert.equal(chapters[0]?.periodKey, weekOneKey);
      assert.equal(chapters[1]?.periodKey, weekTwoKey);
      assert.ok(chapters.slice(2).every((chapter) => chapter.periodKey === null));
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "adapts persisted Pip pacing to short and expanded terms",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    for (const totalWeeks of [6, 24]) {
      const externalLearnerId = `story-length-${totalWeeks}-${crypto.randomUUID()}`;
      try {
        await processEventInDb(
          integration.id,
          externalLearnerId,
          configuredWeek(`length-week-${crypto.randomUUID()}`, 1, totalWeeks),
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
          { asOf: new Date("2026-09-01T12:00:00.000Z") },
        );
        const expected = createPalStoryPlan(totalWeeks);
        const pipWeek = expected.chapters.find(
          (chapter) => chapter.collectible.id === "pip-companion-v1",
        )?.roadmapWeek;
        assert.equal(snapshot.roadmap.weeks.length, totalWeeks);
        assert.equal(snapshot.progression?.storyTotalPeriods, totalWeeks);
        assert.equal(snapshot.progression?.companionUnlockWeek, pipWeek);
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "awards and acknowledges exactly one story reveal for an earned week",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `story-reward-${crypto.randomUUID()}`;
    const periodKey = `reward-week-${crypto.randomUUID()}`;
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        configuredWeek(periodKey, 1, 16),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-08-31" },
          "2026-08-31T15:00:00.000Z",
        ),
        key(),
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      assert.equal(
        (await getDb()
          .select()
          .from(rewardNotices)
          .where(eq(rewardNotices.learnerId, learnerId))).length,
        0,
      );

      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-01" },
          "2026-09-01T15:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-09-02" },
          "2026-09-02T15:00:00.000Z",
        ),
        key(),
      );

      const [weeklyAchievement] = await getDb()
        .select()
        .from(achievementInstances)
        .where(
          and(
            eq(achievementInstances.learnerId, learnerId),
            eq(achievementInstances.achievementKey, "weekly-rhythm"),
            eq(achievementInstances.periodKey, periodKey),
          ),
        );
      assert.equal(weeklyAchievement?.status, "earned");
      const notices = await getDb()
        .select()
        .from(rewardNotices)
        .where(eq(rewardNotices.learnerId, learnerId));
      assert.equal(notices.length, 1);
      assert.equal(notices[0]?.achievementInstanceId, weeklyAchievement?.id);
      assert.equal(notices[0]?.rewardKey, "story:egg-arrives");

      const snapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-02T16:00:00.000Z") },
      );
      assert.equal(snapshot.progression?.collectibles[0]?.status, "earned");
      assert.equal(snapshot.progression?.collectibles[1]?.status, "next");
      assert.equal(snapshot.rewards.length, 1);
      assert.equal(snapshot.rewards[0]?.kind, "story");
      assert.equal(snapshot.rewards[0]?.title, "Something found you");
      assert.equal(snapshot.rewards[0]?.collectibleTitle, "Mystery Egg");
      assert.equal(
        snapshot.rewards[0]?.assetUrl,
        "/assets/world/reward-mystery-egg-v1.png",
      );

      await acknowledgeLearnerReward(
        integration.id,
        learnerId,
        snapshot.rewards[0]!.id,
        getDb(),
      );
      const acknowledged = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-02T16:00:00.000Z") },
      );
      assert.equal(acknowledged.rewards.length, 0);
      assert.equal(acknowledged.progression?.collectibles[0]?.status, "earned");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "persists a story title across a later-week snapshot",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const externalLearnerId = `story-title-${crypto.randomUUID()}`;
    const periodKey = `title-week-${crypto.randomUUID()}`;
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        configuredWeek(periodKey, 1, 6, 1),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "learning_item.completed",
          {
            item_token: `title-item-${crypto.randomUUID()}`,
            kind: "assignment",
            period_key: periodKey,
            timing: "on_time",
          },
          "2026-08-31T14:00:00.000Z",
        ),
        key(),
      );
      await processEventInDb(
        integration.id,
        externalLearnerId,
        event(
          "daily_log.completed",
          { period_key: periodKey, activity_day: "2026-08-31" },
          "2026-08-31T15:00:00.000Z",
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
        { asOf: new Date("2026-08-31T16:00:00.000Z") },
      );

      const storyReward = snapshot.rewards.find(
        (reward) => reward.kind === "story",
      );
      assert.equal(storyReward?.title, "Keep the light on");
      assert.equal(storyReward?.collectibleTitle, "Mystery Egg");
      assert.equal(storyReward?.titleAward, "Gentle Keeper");
      assert.equal(
        storyReward?.titleRevealCopy,
        "Pip remembers who kept the light on.",
      );
      assert.equal(snapshot.progression?.currentTitle, "Gentle Keeper");
      assert.equal(snapshot.progression?.titles.find(
        (title) => title.id === "gentle-keeper",
      )?.status, "earned");

      const weekTwoKey = `title-week-2-${crypto.randomUUID()}`;
      await processEventInDb(
        integration.id,
        externalLearnerId,
        configuredWeek(weekTwoKey, 2, 6, 1),
        key(),
      );
      const laterSnapshot = await loadLearnerSnapshot(
        integration.id,
        learnerId,
        getDb(),
        { asOf: new Date("2026-09-07T16:00:00.000Z") },
      );
      assert.equal(laterSnapshot.roadmap.currentWeek, 2);
      assert.equal(laterSnapshot.progression?.titles.find(
        (title) => title.id === "on-time-pro",
      )?.status, "earned");
      assert.equal(laterSnapshot.progression?.titles.find(
        (title) => title.id === "gentle-keeper",
      )?.status, "earned");
      assert.equal(laterSnapshot.progression?.currentTitle, "Gentle Keeper");
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);
