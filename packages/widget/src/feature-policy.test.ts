import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyFixtureSnapshot } from "./fixture-client";
import {
  applyPalFeaturePolicy,
  DEFAULT_PAL_FEATURE_POLICY,
} from "./feature-policy";

test("title policy conceals titles without dropping story rewards", () => {
  const snapshot = createEmptyFixtureSnapshot();
  snapshot.progression!.currentTitle = "Rhythm Builder";
  snapshot.progression!.titles = [{
    id: "rhythm-builder",
    status: "earned",
    statusLabel: "Earned",
    label: "Rhythm Builder",
    description: "Show up three days in a row.",
  }];
  snapshot.rewards = [
    {
      id: "behavior-title",
      title: "Rhythm Builder earned",
      description: "Show up three days in a row.",
      titleAward: "Rhythm Builder",
    },
    {
      id: "story-reward",
      kind: "story",
      title: "Keep the light on",
      description: "The coldest night arrived.",
      collectibleTitle: "Warming Lantern",
      titleAward: "Gentle Keeper",
    },
  ];

  const visible = applyPalFeaturePolicy(snapshot);

  assert.equal(DEFAULT_PAL_FEATURE_POLICY.achievements.titles, false);
  assert.equal(visible.progression?.currentTitle, undefined);
  assert.equal("currentTitle" in visible.progression!, false);
  assert.deepEqual(visible.progression?.titles, []);
  assert.deepEqual(visible.rewards.map((reward) => reward.id), ["story-reward"]);
  assert.equal(visible.rewards[0]?.titleAward, undefined);
  assert.equal(snapshot.progression?.currentTitle, "Rhythm Builder");
  assert.equal(snapshot.rewards.length, 2);
});

test("snapshot policy can re-enable title presentation without a widget rebuild", () => {
  const snapshot = createEmptyFixtureSnapshot();
  snapshot.featurePolicy = { achievements: { titles: true } };
  snapshot.progression!.currentTitle = "Rhythm Builder";
  snapshot.progression!.titles = [{
    id: "rhythm-builder",
    status: "earned",
    statusLabel: "Earned",
    label: "Rhythm Builder",
    description: "Show up three days in a row.",
  }];
  snapshot.rewards = [{
    id: "behavior-title",
    title: "Rhythm Builder earned",
    description: "Show up three days in a row.",
    titleAward: "Rhythm Builder",
  }];

  assert.strictEqual(applyPalFeaturePolicy(snapshot), snapshot);
});

test("legacy snapshots use the safe default title policy", () => {
  const snapshot = createEmptyFixtureSnapshot();
  delete snapshot.featurePolicy;
  snapshot.rewards = [{
    id: "legacy-title",
    title: "On-Time Pro earned",
    description: "Finish on time.",
    titleAward: "On-Time Pro",
  }];

  assert.deepEqual(applyPalFeaturePolicy(snapshot).rewards, []);
});
