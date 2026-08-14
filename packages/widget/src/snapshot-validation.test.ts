import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureSnapshot } from "./fixture-client";
import { parsePalWidgetSnapshot } from "./snapshot-validation";

test("snapshot parser accepts the bounded v1 fixture", () => {
  const fixture = JSON.parse(
    JSON.stringify(createFixtureSnapshot()),
  ) as unknown;
  assert.deepEqual(parsePalWidgetSnapshot(fixture), fixture);
});

test("snapshot parser accepts an explicitly not-started term", () => {
  const fixture = JSON.parse(
    JSON.stringify(createFixtureSnapshot()),
  ) as ReturnType<typeof createFixtureSnapshot>;
  fixture.roadmap.currentWeek = 0;
  for (const week of fixture.roadmap.weeks) week.status = "future";
  assert.deepEqual(parsePalWidgetSnapshot(fixture), fixture);

  fixture.roadmap.weeks[0]!.status = "current";
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /must all be future when the term has not started/i,
  );
});

test("snapshot parser keeps XP fields backward-compatible in schema version 1", () => {
  const fixture = createFixtureSnapshot();
  delete fixture.companion.xp;
  delete fixture.companion.xpToNextLevel;
  const legacySnapshot = JSON.parse(JSON.stringify(fixture)) as unknown;

  assert.deepEqual(parsePalWidgetSnapshot(legacySnapshot), legacySnapshot);
});

test("snapshot parser rejects unsupported schema versions", () => {
  const fixture: unknown = {
    ...createFixtureSnapshot(),
    schemaVersion: 2,
  };
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /supported schema version 1/i,
  );
});

test("snapshot parser rejects malformed nested values", () => {
  const fixture = createFixtureSnapshot() as unknown as {
    roadmap: { weeks: Array<{ achievements: Array<{ progress?: unknown }> }> };
  };
  fixture.roadmap.weeks[0]!.achievements[0]!.progress = {
    current: 5,
    target: 4,
    label: "invalid",
  };
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /current.*must not exceed target/i,
  );
});

test("snapshot parser bounds server-controlled collections", () => {
  const fixture = createFixtureSnapshot() as unknown as {
    rewards: unknown[];
  };
  fixture.rewards = Array.from({ length: 101 }, (_, index) => ({
    id: `reward-${index}`,
    title: "Reward",
    description: "Description",
  }));
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /rewards.*0 to 100 entries/i,
  );
});

test("snapshot parser rejects unsafe and unapproved asset URLs", () => {
  const unsafe = createFixtureSnapshot();
  unsafe.companion.assetUrl = "javascript:alert(1)";
  assert.throws(
    () => parsePalWidgetSnapshot(unsafe),
    /HTTPS origin|root-relative/i,
  );

  const unapproved = createFixtureSnapshot();
  unapproved.companion.assetUrl = "https://tracker.example/pet.png";
  assert.throws(
    () => parsePalWidgetSnapshot(unapproved),
    /not in the allowed Pal asset origin list/i,
  );
});

test("snapshot parser rejects root-relative URL normalization bypasses", () => {
  for (const assetUrl of [
    String.raw`/\evil.example/pet.png`,
    String.raw`/\\evil.example/pet.png`,
    "//evil.example/pet.png",
  ]) {
    const fixture = createFixtureSnapshot();
    fixture.companion.assetUrl = assetUrl;
    assert.throws(
      () =>
        parsePalWidgetSnapshot(fixture, {
          assetBaseUrl: "https://api.pal.example",
        }),
      /without backslashes|protocol-relative prefix/i,
    );
  }
});

test("snapshot parser resolves relative assets and permits explicit Pal CDN origins", () => {
  const fixture = createFixtureSnapshot();
  fixture.roadmap.weeks[0]!.achievements[0]!.badge.assetUrl =
    "https://assets.pal.example/badges/rhythm.png";

  const parsed = parsePalWidgetSnapshot(fixture, {
    assetBaseUrl: "https://api.pal.example",
    allowedAssetOrigins: ["https://assets.pal.example"],
  });

  assert.equal(
    parsed.companion.assetUrl,
    "https://api.pal.example/assets/pets/default.png",
  );
  assert.equal(
    parsed.roadmap.weeks[0]!.achievements[0]!.badge.assetUrl,
    "https://assets.pal.example/badges/rhythm.png",
  );
});
