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
  assert.equal(plan.chapters[7]?.collectible.kind, "wallpaper");
  assert.match(plan.chapters[7]?.collectible.darkAssetUrl ?? "", /-dark-v4\.png$/);
  assert.equal(plan.chapters[10]?.collectible.kind, "companion");
});

test("adding the Home catalog does not activate its writer", () => {
  assert.deepEqual(storyForTermStartDay("9999-12-31"), {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
  });
});
