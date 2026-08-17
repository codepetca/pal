import assert from "node:assert/strict";
import test from "node:test";

import { resolvePalAchievementPresentation } from "./achievement-presentation";

test("achievement presentation lookup ignores inherited object properties", () => {
  for (const key of ["constructor", "toString", "__proto__", "unknown"]) {
    assert.equal(resolvePalAchievementPresentation(key), undefined);
  }

  assert.equal(
    resolvePalAchievementPresentation("on-time-finish")?.title,
    "On-Time Finish",
  );
});
