import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
} from "./fixture-client";
import { parsePalWidgetSnapshot } from "./snapshot-validation";

test("snapshot parser accepts the bounded v1 fixture", () => {
  const fixture = JSON.parse(
    JSON.stringify(createFixtureSnapshot()),
  ) as unknown;
  assert.deepEqual(parsePalWidgetSnapshot(fixture), fixture);
});

test("snapshot parser preserves the v1 current-week domain", () => {
  const fixture = JSON.parse(
    JSON.stringify(createFixtureSnapshot()),
  ) as ReturnType<typeof createFixtureSnapshot>;
  fixture.roadmap.currentWeek = 1;
  for (const week of fixture.roadmap.weeks) week.status = "future";
  assert.deepEqual(parsePalWidgetSnapshot(fixture), fixture);

  fixture.roadmap.currentWeek = 0;
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /greater than or equal to 1/i,
  );
});

test("snapshot parser requires one contiguous entry for every roadmap week", () => {
  const duplicate = createFixtureSnapshot();
  duplicate.roadmap.weeks[1]!.number = duplicate.roadmap.weeks[0]!.number;
  assert.throws(
    () => parsePalWidgetSnapshot(duplicate),
    /unique roadmap week/i,
  );

  const gap = createFixtureSnapshot();
  gap.roadmap.weeks[1]!.number = 99;
  assert.throws(
    () => parsePalWidgetSnapshot(gap),
    /contiguous range/i,
  );
});

test("snapshot parser keeps XP fields backward-compatible in schema version 1", () => {
  const fixture = createFixtureSnapshot();
  delete fixture.companion.xp;
  delete fixture.companion.xpToNextLevel;
  const legacySnapshot = JSON.parse(JSON.stringify(fixture)) as unknown;

  assert.deepEqual(parsePalWidgetSnapshot(legacySnapshot), legacySnapshot);
});

test("snapshot parser keeps collection backward-compatible in schema version 1", () => {
  const fixture = createFixtureSnapshot();
  delete fixture.collection;
  const legacySnapshot = JSON.parse(JSON.stringify(fixture)) as unknown;

  assert.deepEqual(parsePalWidgetSnapshot(legacySnapshot), legacySnapshot);
});

test("snapshot parser keeps progression optional in schema version 1", () => {
  const fixture = createFixtureSnapshot();
  delete fixture.progression;
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

test("snapshot parser preserves a presentation-safe achievement celebration", () => {
  const fixture = {
    ...createFixtureSnapshot(),
    rewards: [{
      id: "notice-1",
      kind: "achievement",
      achievement: {
        id: "achievement-1",
        key: "on-time-finish",
        title: "On-Time Finish",
        description: "Completed a learning item by its deadline.",
        badge: {
          label: "On-Time Finish",
          assetUrl: "/assets/badges/badge-on-time-finish.png",
        },
      },
    }],
  };

  const parsed = parsePalWidgetSnapshot(fixture).rewards[0];
  assert.equal(parsed?.kind, "standard");
  assert.equal(parsed?.title, "On-Time Finish");
  assert.equal(parsed?.description, "Completed a learning item by its deadline.");
  assert.equal(parsed?.achievement?.key, "on-time-finish");

  const unknown = structuredClone(fixture) as unknown as {
    rewards: Array<{ achievement: { key: string } }>;
  };
  unknown.rewards[0]!.achievement.key = "unknown-achievement";
  assert.throws(
    () => parsePalWidgetSnapshot(unknown),
    /achievement\.key.*expected one of/i,
  );
});

test("new achievement celebrations retain the deployed schema-v1 reward envelope", () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());
  client.dispatch("classroom-joined");
  const reward = client.peek().rewards.find(
    (candidate) => candidate.achievement !== undefined,
  );
  assert.ok(reward);

  // This is the outer contract required by the parser shipped before nested
  // achievement presentation was added. Unknown fields are intentionally ignored.
  assert.equal(reward.kind, "standard");
  assert.equal(typeof reward.title, "string");
  assert.equal(typeof reward.description, "string");
  assert.ok(reward.title.length > 0);
  assert.ok(reward.description.length > 0);
});

test("snapshot parser bounds and deduplicates durable collection items", () => {
  const tooMany = createFixtureSnapshot();
  tooMany.collection = {
    items: Array.from({ length: 51 }, (_, index) => ({
      id: `item-${index}`,
      label: "Item",
      description: "Description",
    })),
  };
  assert.throws(
    () => parsePalWidgetSnapshot(tooMany),
    /collection\.items.*0 to 50 entries/i,
  );

  const duplicate = createFixtureSnapshot();
  duplicate.collection = {
    items: [
      { id: "same", label: "One", description: "One" },
      { id: "same", label: "Two", description: "Two" },
    ],
  };
  assert.throws(
    () => parsePalWidgetSnapshot(duplicate),
    /collection\.items\[1\]\.id.*unique/i,
  );
});

test("snapshot parser allows at most one collectible reward per roadmap week", () => {
  const fixture = createFixtureSnapshot();
  fixture.progression!.collectibles[1]!.roadmapWeek =
    fixture.progression!.collectibles[0]!.roadmapWeek;

  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /unique roadmap week/i,
  );
});

test("snapshot parser requires one collectible decision for every roadmap week", () => {
  const fixture = createFixtureSnapshot();
  fixture.progression!.collectibles.pop();

  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /collectibles.*exactly one decision for every roadmap week/i,
  );
});

test("snapshot parser keeps progression references inside the supplied roadmap", () => {
  const collectibleOutsideRoadmap = createFixtureSnapshot();
  collectibleOutsideRoadmap.progression!.collectibles[0]!.roadmapWeek = 99;
  assert.throws(
    () => parsePalWidgetSnapshot(collectibleOutsideRoadmap),
    /collectibles\[0\]\.roadmapWeek.*supplied roadmap week/i,
  );

  const privateStoryMetadata = createFixtureSnapshot() as unknown as {
    progression: Record<string, unknown>;
  };
  privateStoryMetadata.progression.storyId = "private-story-name";
  assert.throws(
    () => parsePalWidgetSnapshot(privateStoryMetadata),
    /no private story catalog metadata/i,
  );
});

test("snapshot parser requires one canonical companion reveal decision", () => {
  const fixture = createFixtureSnapshot() as unknown as {
    progression: Record<string, unknown>;
  };
  fixture.progression.companionUnlocked = true;
  fixture.progression.companionUnlockWeek = 1;

  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /one canonical companionReveal decision/i,
  );
});

test("snapshot parser rejects concealed content on locked rewards", () => {
  const fixture = createFixtureSnapshot(2) as unknown as {
    progression: {
      collectibles: Array<Record<string, unknown>>;
      titles: Array<Record<string, unknown>>;
    };
  };
  fixture.progression.collectibles[1]!.title = "Cloud Blanket";
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /concealed collectible content while locked/i,
  );

  const lockedTitle = createFixtureSnapshot(2) as unknown as {
    progression: { titles: Array<Record<string, unknown>> };
  };
  lockedTitle.progression.titles.push({
    id: "locked-title",
    status: "locked",
    statusLabel: "Locked",
    label: "Secret title",
  });
  assert.throws(
    () => parsePalWidgetSnapshot(lockedTitle),
    /concealed title content while locked/i,
  );
});

test("snapshot parser accepts only sketch or color collectible finishes", () => {
  const fixture = createFixtureSnapshot(2);
  fixture.progression!.collectibles[0] = {
    id: "week-one-keepsake",
    chapterId: "week-one-chapter",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Story keepsake",
    title: "Mystery Egg",
    description: "The story begins.",
    kind: "room",
    finish: "sketch",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  };
  const parsed = parsePalWidgetSnapshot(fixture).progression?.collectibles[0];
  assert.equal(parsed?.status === "earned" ? parsed.finish : undefined, "sketch");

  (fixture.progression!.collectibles[0] as unknown as { finish: string }).finish = "gold";
  assert.throws(
    () => parsePalWidgetSnapshot(fixture),
    /collectibles\[0\]\.finish/i,
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

  const unsafeCollectible = createFixtureSnapshot();
  unsafeCollectible.progression!.collectibles[0] = {
    id: "earned-collectible",
    roadmapWeek: 1,
    status: "earned",
    statusLabel: "Earned",
    title: "Earned collectible",
    description: "Already earned.",
    kind: "room",
    assetUrl: "javascript:alert(1)",
  };
  assert.throws(
    () => parsePalWidgetSnapshot(unsafeCollectible),
    /progression.*assetUrl.*HTTPS origin|root-relative/i,
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
  const fixture = createFixtureSnapshot(5);
  fixture.companion.assetUrl = "/assets/pets/default.png";
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
