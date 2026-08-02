import assert from "node:assert/strict";
import test from "node:test";

import { createFixturePalClient } from "./fixture-client";

test("fixture client exposes a 16-week roadmap with a current week", async () => {
  const client = createFixturePalClient();
  const snapshot = await client.getSnapshot();

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.roadmap.weeks.length, 16);
  assert.equal(snapshot.roadmap.currentWeek, 4);
  assert.equal(
    snapshot.roadmap.weeks.filter((week) => week.status === "current").length,
    1,
  );
});

test("fixture actions update visible state while duplicate replay is inert", async () => {
  const client = createFixturePalClient();

  client.dispatch("daily-log-completed");
  const afterCompletion = await client.getSnapshot();
  const currentWeek = afterCompletion.roadmap.weeks.find(
    (week) => week.status === "current",
  );
  const rhythm = currentWeek?.achievements.find((achievement) =>
    achievement.id.startsWith("weekly-rhythm"),
  );

  assert.equal(rhythm?.progress?.current, 1);

  const beforeDuplicate = client.peek();
  const result = client.dispatch("duplicate-replayed");
  const afterDuplicate = client.peek();

  assert.match(result, /no progress changed/i);
  assert.deepEqual(afterDuplicate, beforeDuplicate);
});

test("fixture reward can be acknowledged exactly once by the client", async () => {
  const client = createFixturePalClient();

  client.dispatch("reward-earned");
  const reward = (await client.getSnapshot()).rewards[0];
  assert.ok(reward);

  await client.markRewardSeen(reward.id);
  assert.equal((await client.getSnapshot()).rewards.length, 0);

  await client.markRewardSeen(reward.id);
  assert.equal((await client.getSnapshot()).rewards.length, 0);
});
