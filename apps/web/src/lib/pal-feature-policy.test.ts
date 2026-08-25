import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PAL_FEATURE_POLICY } from "@codepet/pal-widget/feature-policy";
import { resolvePalFeaturePolicy } from "@/lib/pal-feature-policy";

test("Pal feature policy keeps achievement titles hidden by default", () => {
  assert.deepEqual(resolvePalFeaturePolicy({}), DEFAULT_PAL_FEATURE_POLICY);
  assert.deepEqual(
    resolvePalFeaturePolicy({ PAL_ACHIEVEMENT_TITLES_VISIBLE: "" }),
    DEFAULT_PAL_FEATURE_POLICY,
  );
});

test("Pal feature policy accepts explicit title presentation switches", () => {
  assert.equal(resolvePalFeaturePolicy({
    PAL_ACHIEVEMENT_TITLES_VISIBLE: "true",
  }).achievements.titles, true);
  assert.equal(resolvePalFeaturePolicy({
    PAL_ACHIEVEMENT_TITLES_VISIBLE: " FALSE ",
  }).achievements.titles, false);
});

test("Pal feature policy rejects ambiguous title presentation configuration", () => {
  assert.throws(
    () => resolvePalFeaturePolicy({
      PAL_ACHIEVEMENT_TITLES_VISIBLE: "enabled",
    }),
    /PAL_ACHIEVEMENT_TITLES_VISIBLE must be true or false/,
  );
});
