import assert from "node:assert/strict";
import test from "node:test";
import { createStoryFixturePalClient } from "./fixture-story-client";
import { parseFixtureStoryRequest } from "./fixture-story-contract";
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
      commands: Array.from({ length: 257 }, (_, index) => ({
        type: "acknowledge",
        rewardId: `reward-${index}`,
      })),
    }),
    undefined,
  );
});
