import assert from "node:assert/strict";
import test from "node:test";
import { parsePalWidgetSnapshot } from "@codepet/pal-widget";
import { createStoryFixturePalClient } from "./fixture-story-client";
import {
  MAX_FIXTURE_COMMANDS,
  parseFixtureStoryRequest,
} from "./fixture-story-contract";
import { projectStoryFixture } from "@/lib/story-fixture";

test("interactive fixture uses the server projector and keeps acknowledged ownership", async () => {
  const fetchFixture: typeof fetch = async (_input, init) => {
    const parsed = parseFixtureStoryRequest(JSON.parse(String(init?.body)));
    assert.ok(parsed);
    return Response.json(await projectStoryFixture(parsed));
  };
  const client = createStoryFixturePalClient("https://pal.example", fetchFixture);

  for (const activityDay of [
    "2026-04-13",
    "2026-04-14",
    "2026-04-15",
    "2026-04-16",
  ]) {
    client.dispatch("daily-log-completed", { activityDay });
  }
  const earned = await client.getSnapshot();
  assert.equal(earned.progression?.collectibles[0]?.status, "earned");
  assert.equal(
    earned.progression?.titles.some((title) => title.id === "rhythm-builder"),
    true,
  );
  const storyReward = earned.rewards.find((reward) => reward.kind === "story");
  assert.ok(storyReward);
  assert.deepEqual(
    earned.rewards.map((reward) => reward.kind ?? "standard"),
    ["standard", "story", "standard"],
  );
  assert.equal(
    earned.rewards.some((reward) => reward.achievement !== undefined),
    true,
  );

  await client.markRewardSeen(storyReward.id);
  const acknowledged = await client.getSnapshot();
  assert.equal(
    acknowledged.rewards.some((reward) => reward.id === storyReward.id),
    false,
  );
  assert.equal(acknowledged.progression?.collectibles[0]?.status, "earned");
});

test("fixture story request rejects private or unbounded commands", () => {
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      learner_name: "Alice Example",
      commands: [],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: [{
        type: "action",
        id: "private-command",
        action: "session-started",
        email: "alice@example.test",
      }],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: [{
        type: "action",
        id: "private-context",
        action: "session-started",
        context: { student_writing: "private text" },
      }],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: [{
        type: "acknowledge",
        rewardId: "fixture-grant-1",
        email: "alice@example.test",
      }],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({ termWeeks: 25, commands: [] }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: [{ type: "action", id: "x", action: "reset" }],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: [
        { type: "action", id: "same", action: "daily-log-completed" },
        { type: "action", id: "same", action: "daily-log-completed" },
      ],
    }),
    undefined,
  );
  assert.equal(
    parseFixtureStoryRequest({
      termWeeks: 16,
      commands: Array.from({ length: MAX_FIXTURE_COMMANDS + 1 }, (_, index) => ({
        type: "acknowledge",
        rewardId: `reward-${index}`,
      })),
    }),
    undefined,
  );
});

test("legacy reward fixture histories remain valid and inert", async () => {
  const baseline = await projectStoryFixture({ termWeeks: 16, commands: [] });
  const request = parseFixtureStoryRequest({
    termWeeks: 16,
    commands: [{
      type: "action",
      id: "legacy-reward-action",
      action: "reward-earned",
    }],
  });
  assert.ok(request);

  assert.deepEqual(await projectStoryFixture(request), baseline);
});

test("the maximum accepted action history still produces a valid public snapshot", async () => {
  const request = parseFixtureStoryRequest({
    termWeeks: 16,
    commands: Array.from({ length: MAX_FIXTURE_COMMANDS }, (_, index) => ({
      type: "action",
      id: `ready-${index}`,
      action: "item-opened-early",
      context: { itemToken: `item-${index}` },
    })),
  });
  assert.ok(request);
  const snapshot = await projectStoryFixture(request);
  assert.equal(
    snapshot.roadmap.weeks[0]?.achievements.length,
    MAX_FIXTURE_COMMANDS,
  );
  assert.doesNotThrow(() => parsePalWidgetSnapshot(snapshot));
});
