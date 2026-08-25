import assert from "node:assert/strict";
import test from "node:test";
import { storyPlanPeriodCountMatchesTerm } from "@/lib/story-plan";

test("accepts both legacy full-term and capped story plan lengths", () => {
  assert.equal(storyPlanPeriodCountMatchesTerm(20, 20, 16), true);
  assert.equal(storyPlanPeriodCountMatchesTerm(16, 20, 16), true);
  assert.equal(storyPlanPeriodCountMatchesTerm(15, 20, 16), false);
});
