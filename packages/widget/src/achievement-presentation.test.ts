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

test("login and classroom achievements use distinct badge artwork", () => {
  const firstLogin = resolvePalAchievementPresentation("first-pika-login");
  const joinedClass = resolvePalAchievementPresentation("joined-class");

  assert.notEqual(firstLogin?.badge.assetUrl, joinedClass?.badge.assetUrl);
  assert.equal(
    firstLogin?.badge.assetUrl,
    "/assets/badges/badge-first-classroom-login-v1.png",
  );
  assert.equal(
    joinedClass?.badge.assetUrl,
    "/assets/badges/badge-joined-class-v1.png",
  );
});
