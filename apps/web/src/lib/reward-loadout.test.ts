import assert from "node:assert/strict";
import test from "node:test";
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
  rewards: readonly { assignmentId: string; rewardId: string }[],
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
        kind: "wallpaper" as const,
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
