import assert from "node:assert/strict";
import test from "node:test";

import type { PalFixtureAction, PalRewardNotice } from "./types";

const legacyFixtureAction: PalFixtureAction = "reward-earned";

// Keep the original schema-v1 host access pattern compiling even after
// achievement celebrations add their richer optional presentation payload.
function legacyGrantFields(notice: PalRewardNotice) {
  return {
    collectibleTitle: notice.collectibleTitle,
    titleAward: notice.titleAward,
    titleRevealCopy: notice.titleRevealCopy,
  };
}

test("keeps legacy reward notice fields readable without variant narrowing", () => {
  assert.deepEqual(
    legacyGrantFields({
      id: "grant-1",
      title: "Story unlocked",
      description: "A keepsake arrived.",
      collectibleTitle: "Mystery Egg",
    }),
    {
      collectibleTitle: "Mystery Egg",
      titleAward: undefined,
      titleRevealCopy: undefined,
    },
  );
});

test("keeps the retired fixture reward action available to existing consumers", () => {
  assert.equal(legacyFixtureAction, "reward-earned");
});
