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
