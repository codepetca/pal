import assert from "node:assert/strict";
import test from "node:test";
import {
  HOME_STORY_ID,
  HOME_STORY_PERIODS,
  HOME_STORY_VERSION,
  PIP_STORY_ID,
  PIP_STORY_VERSION,
  STORY_REGISTRY,
  storyForTermStartDay,
} from "@/lib/story-catalog";

test("registers the dormant 16-chapter Home catalog and its selectable art", () => {
  const plan = STORY_REGISTRY.createPlan(20, {
    storyId: HOME_STORY_ID,
    version: HOME_STORY_VERSION,
  });

  assert.equal(plan.totalPeriods, HOME_STORY_PERIODS);
  assert.equal(plan.chapters.length, HOME_STORY_PERIODS);
  assert.equal(plan.chapters[6]?.collectible.kind, "cosmetic");
  assert.equal(plan.chapters[7]?.collectible.kind, "room");
  assert.match(plan.chapters[7]?.collectible.darkAssetUrl ?? "", /-dark-v4\.png$/);
  assert.equal(plan.chapters[10]?.collectible.kind, "companion");

  const pipPlan = STORY_REGISTRY.createPlan(20, {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
  });
  const pipCollectibleIds = new Set(
    pipPlan.chapters.map((chapter) => chapter.collectible.id),
  );
  assert.equal(
    plan.chapters.some((chapter) => pipCollectibleIds.has(chapter.collectible.id)),
    false,
  );
  assert.match(plan.chapters[0]?.collectible.assetUrl ?? "", /home-warming-lantern-v1\.png$/);
  assert.match(plan.chapters[1]?.collectible.assetUrl ?? "", /home-mystery-egg-v1\.png$/);
  assert.match(plan.chapters[10]?.collectible.assetUrl ?? "", /home-lumi-v1\.png$/);
});

test("adding the Home catalog does not activate its writer", () => {
  assert.deepEqual(storyForTermStartDay("9999-12-31"), {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
  });
});
