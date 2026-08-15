import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PROGRESSION_POLICY } from "./progression-policy";

describe("PROGRESSION_POLICY", () => {
  it("keeps the representative 16-week term balanced and paced", () => {
    const onTimeItems = 15;
    const termWeeks = 16;
    const dailyLogDaysPerWeek = 4;
    const assignmentXp =
      onTimeItems *
      (PROGRESSION_POLICY.learningItemXp +
        PROGRESSION_POLICY.learningItemOnTimeBonusXp);
    const reflectionXp =
      termWeeks *
      (dailyLogDaysPerWeek * PROGRESSION_POLICY.dailyLogXp +
        PROGRESSION_POLICY.weeklyRhythmXp);
    const totalXp = assignmentXp + reflectionXp;

    assert.equal(assignmentXp, 1_500);
    assert.equal(reflectionXp, 1_840);
    assert.equal(totalXp, 3_340);
    assert.equal(
      1 + Math.floor(totalXp / PROGRESSION_POLICY.levelUpCostXp),
      7,
    );
    assert.equal(totalXp % PROGRESSION_POLICY.levelUpCostXp, 340);
  });

  it("defines unique, increasing collection milestones through week 16", () => {
    const milestones = PROGRESSION_POLICY.collectionMilestones;
    assert.deepEqual(
      milestones.map((milestone) => milestone.weeklyRhythms),
      [1, 4, 8, 12, 16],
    );
    assert.equal(
      new Set(milestones.map((milestone) => milestone.assetRefId)).size,
      milestones.length,
    );
  });
});
