import assert from "node:assert/strict";
import test from "node:test";

import { createPalProgressionState } from "./progression";

test("keeps Pip hidden while revealing only earned weekly chapters", () => {
  const progression = createPalProgressionState({
    currentWeek: 2,
    totalWeeks: 16,
    level: 10,
    streak: 10,
    achievements: [],
    earnedWeeks: [1],
  });

  assert.equal(progression.companionReveal.status, "locked");
  assert.match(
    progression.companionReveal.status === "locked"
      ? progression.companionReveal.label
      : "",
    /Complete Week 4 to meet Pip/,
  );
  assert.equal(progression.collectibles[0]?.status, "earned");
  assert.equal(progression.collectibles[1]?.status, "next");
  assert.equal("title" in progression.collectibles[1]!, false);
  assert.equal(
    progression.collectibles.find((item) => item.roadmapWeek === 4)?.status,
    "locked",
  );
});

test("unlocks collectibles and advances the learner title from durable state", () => {
  const progression = createPalProgressionState({
    currentWeek: 8,
    totalWeeks: 16,
    level: 5,
    streak: 7,
    achievements: [
      {
        id: "on-time-finish-week-2",
        title: "On-Time Finish",
        description: "Finished on time.",
        status: "earned",
        statusLabel: "Earned",
        badge: { label: "On-Time Finish" },
      },
    ],
    earnedWeeks: Array.from({ length: 8 }, (_, index) => index + 1),
  });

  assert.equal(progression.companionReveal.status, "earned");
  assert.equal(
    progression.companionReveal.assetUrl,
    "/assets/pets/default.png",
  );
  assert.equal(progression.currentTitle, "Brave Beginner");
  assert.equal(
    progression.collectibles.find((item) => item.id === "measuring-spoons-v1")?.status,
    "earned",
  );
  assert.equal(
    progression.titles.find((title) => title.id === "on-time-pro")?.status,
    "earned",
  );
});

test("keeps the latest earned story title displayed after its reveal week", () => {
  const progression = createPalProgressionState({
    currentWeek: 9,
    totalWeeks: 16,
    level: 5,
    streak: 7,
    achievements: [],
    earnedWeeks: Array.from({ length: 8 }, (_, index) => index + 1),
  });

  assert.equal(progression.currentTitle, "Brave Beginner");
});

test("uses durable award chronology when a later behavior title is supplied", () => {
  const progression = createPalProgressionState({
    currentWeek: 4,
    totalWeeks: 16,
    level: 2,
    streak: 3,
    achievements: [
      {
        id: "on-time-finish-week-4",
        title: "On-Time Finish",
        description: "Finished on time.",
        status: "earned",
        statusLabel: "Earned",
        badge: { label: "On-Time Finish" },
      },
    ],
    earnedWeeks: [1, 2, 3, 4],
    currentTitleId: "on-time-pro",
  });

  assert.equal(progression.currentTitle, "On-Time Pro");
});
