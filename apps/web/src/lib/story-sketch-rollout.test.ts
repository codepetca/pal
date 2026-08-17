import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { parseStorySketchRewardsEffectiveAt } from "@/lib/story-sketch-rollout";

test("story sketch rollout timestamp is strict, optional, and timezone-stable", () => {
  assert.equal(parseStorySketchRewardsEffectiveAt(undefined), undefined);
  assert.equal(parseStorySketchRewardsEffectiveAt("  "), undefined);
  assert.equal(
    parseStorySketchRewardsEffectiveAt("2026-08-17T01:30:00Z")?.toISOString(),
    "2026-08-17T01:30:00.000Z",
  );
  assert.equal(
    parseStorySketchRewardsEffectiveAt("2026-08-16T21:30:00-04:00")?.toISOString(),
    "2026-08-17T01:30:00.000Z",
  );
  for (const invalid of [
    "2026/08/17",
    "08/17/2026",
    "0",
    "2026-08-17T01:30:00",
    "2026-02-30T01:30:00Z",
    "2026-08-17T25:30:00Z",
    "2026-08-17T01:30:00+24:00",
  ]) {
    assert.throws(
      () => parseStorySketchRewardsEffectiveAt(invalid),
      /PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT/,
    );
  }
});

test("malformed rollout configuration fails when a server worker starts", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--eval",
      'import("./src/lib/story-sketch-rollout.ts")',
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT: "not-a-timestamp",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /PAL_STORY_SKETCH_REWARDS_EFFECTIVE_AT/,
  );
});
