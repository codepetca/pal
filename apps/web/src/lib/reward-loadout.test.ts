import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixtureSnapshot,
  parsePalWidgetSnapshot,
} from "@codepet/pal-widget";
import {
  projectRewardLoadout,
  rewardLoadoutSlot,
} from "@/lib/reward-loadout";
import type { PersistedStoryPlan } from "@/lib/story-plan";

test("only companions and wallpapers have loadout slots", () => {
  assert.equal(rewardLoadoutSlot("companion"), "companion");
  assert.equal(rewardLoadoutSlot("wallpaper"), "wallpaper");
  assert.equal(rewardLoadoutSlot("keepsake"), undefined);
});

function plan(
  id: string,
  rewards: readonly {
    assignmentId: string;
    rewardId: string;
    kind?: "companion" | "wallpaper";
  }[],
): PersistedStoryPlan {
  return {
    id,
    learnerId: "learner",
    termKey: id,
    termStartDay: "2026-01-01",
    storyId: "story",
    version: 1,
    totalPeriods: rewards.length,
    companionCollectibleId: "pip",
    mysteryCollectibleId: "egg",
    chapters: rewards.map((reward, index) => ({
      id: `chapter-${index}`,
      act: 1,
      kind: "core" as const,
      revealHeadline: "Reveal",
      storyCopy: "Story",
      roadmapWeek: index + 1,
      sourceChapterIds: [`chapter-${index}`],
      periodKey: `period-${index}`,
      assignmentId: reward.assignmentId,
      collectible: {
        id: reward.rewardId,
        title: reward.rewardId,
        kind: reward.kind ?? "wallpaper",
        assetUrl: `/assets/${reward.rewardId}.png`,
      },
    })),
  };
}

function grant(id: string, storyPlanId: string, assignmentId: string, order: number) {
  return {
    id,
    kind: "story_chapter",
    storyPlanId,
    storyPlanChapterId: assignmentId,
    grantOrder: BigInt(order),
  };
}

test("loadout projection deduplicates recurring rewards and preserves semantic equipment", () => {
  const oldPlan = plan("old-plan", [{ assignmentId: "old-wallpaper", rewardId: "courtyard" }]);
  const newPlan = plan("new-plan", [{ assignmentId: "new-wallpaper", rewardId: "courtyard" }]);
  const projected = projectRewardLoadout(
    [
      grant("old-grant", oldPlan.id, "old-wallpaper", 1),
      grant("new-grant", newPlan.id, "new-wallpaper", 2),
    ] as never,
    new Map([[oldPlan.id, oldPlan], [newPlan.id, newPlan]]),
    [{ slot: "wallpaper", rewardGrantId: "old-grant" }] as never,
  );

  assert.deepEqual(projected.wallpaper.options.map((option) => option.grantId), ["new-grant"]);
  assert.equal(projected.wallpaper.equippedGrantId, "new-grant");
});

test("loadout projection remains bounded while retaining the equipped reward", () => {
  const rewards = Array.from({ length: 35 }, (_, index) => ({
    assignmentId: `assignment-${index}`,
    rewardId: `wallpaper-${index}`,
  }));
  const storyPlan = plan("many-plan", rewards);
  const projected = projectRewardLoadout(
    rewards.map((reward, index) =>
      grant(`grant-${index}`, storyPlan.id, reward.assignmentId, index + 1),
    ) as never,
    new Map([[storyPlan.id, storyPlan]]),
    [{ slot: "wallpaper", rewardGrantId: "grant-0" }] as never,
  );

  assert.equal(projected.wallpaper.options.length, 32);
  assert.equal(projected.wallpaper.equippedGrantId, "grant-0");
  assert.ok(projected.wallpaper.options.some((option) => option.grantId === "grant-0"));
});

test("companion projection identifies Pip as the fallback without making it toggleable", () => {
  const storyPlan = plan("companion-plan", [
    { assignmentId: "pip", rewardId: "pip", kind: "companion" },
    { assignmentId: "lumi", rewardId: "lumi", kind: "companion" },
  ]);
  const grants = [
    grant("grant-pip", storyPlan.id, "pip", 1),
    grant("grant-lumi", storyPlan.id, "lumi", 2),
  ] as never;
  const plans = new Map([[storyPlan.id, storyPlan]]);

  const fallback = projectRewardLoadout(grants, plans, []);
  assert.equal(fallback.companion.fallbackGrantId, "grant-pip");
  assert.equal(fallback.companion.equippedGrantId, "grant-pip");

  const selected = projectRewardLoadout(
    grants,
    plans,
    [{ slot: "companion", rewardGrantId: "grant-lumi" }] as never,
  );
  assert.equal(selected.companion.fallbackGrantId, "grant-pip");
  assert.equal(selected.companion.equippedGrantId, "grant-lumi");
});

test("bounded companion projection retains distinct equipped and fallback options", () => {
  const rewards = Array.from({ length: 35 }, (_, index) => ({
    assignmentId: `companion-assignment-${index}`,
    rewardId: index === 0 ? "pip" : `companion-${index}`,
    kind: "companion" as const,
  }));
  const firstPlan = plan("companion-plan-one", rewards.slice(0, 18));
  const secondPlan = plan("companion-plan-two", rewards.slice(18));
  const grants = [
    ...firstPlan.chapters.map((chapter, index) =>
      grant(`companion-grant-${index}`, firstPlan.id, chapter.assignmentId, index + 1),
    ),
    ...secondPlan.chapters.map((chapter, index) =>
      grant(
        `companion-grant-${index + 18}`,
        secondPlan.id,
        chapter.assignmentId,
        index + 19,
      ),
    ),
  ];
  const projected = projectRewardLoadout(
    grants as never,
    new Map([[firstPlan.id, firstPlan], [secondPlan.id, secondPlan]]),
    [{ slot: "companion", rewardGrantId: "companion-grant-34" }] as never,
  );

  assert.equal(projected.companion.options.length, 32);
  assert.equal(projected.companion.equippedGrantId, "companion-grant-34");
  assert.equal(projected.companion.fallbackGrantId, "companion-grant-0");
  assert.ok(projected.companion.options.some(
    (option) => option.grantId === projected.companion.fallbackGrantId,
  ));
  const snapshot = createFixtureSnapshot();
  snapshot.rewardLoadout = projected;
  assert.deepEqual(parsePalWidgetSnapshot(snapshot).rewardLoadout, projected);
});
