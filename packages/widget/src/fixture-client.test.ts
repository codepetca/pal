import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
} from "./fixture-client";

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

  assert.equal(rhythm?.progress?.current, 3);

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

test("fresh fixture activates Weekly Rhythm and preserves partial history", async () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());

  client.dispatch("daily-log-completed");
  client.dispatch("advance-week");

  const snapshot = client.peek();
  const weekOneRhythm = snapshot.roadmap.weeks[0]!.achievements.find(
    (achievement) => achievement.title === "Weekly Rhythm",
  );
  const weekTwoRhythm = snapshot.roadmap.weeks[1]!.achievements.find(
    (achievement) => achievement.title === "Weekly Rhythm",
  );

  assert.equal(snapshot.roadmap.currentWeek, 2);
  assert.equal(weekOneRhythm?.status, "in-progress");
  assert.deepEqual(weekOneRhythm?.progress, {
    current: 1,
    target: 4,
    label: "1 of 4 eligible days",
  });
  assert.deepEqual(weekTwoRhythm?.progress, {
    current: 0,
    target: 4,
    label: "0 of 4 eligible days",
  });
});

test("fixture deduplicates one activity day but keeps genuine items distinct", () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());

  client.dispatch("daily-log-completed", { activityDay: "2026-04-13" });
  const duplicate = client.dispatch("daily-log-completed", {
    activityDay: "2026-04-13",
  });
  client.dispatch("on-time-finish", { itemToken: "item-a" });
  const duplicateItem = client.dispatch("late-finish", {
    itemToken: "item-a",
  });
  client.dispatch("on-time-finish", { itemToken: "item-b" });

  const snapshot = client.peek();
  const achievements = snapshot.roadmap.weeks[0]!.achievements;
  assert.match(duplicate, /semantic duplicate/i);
  assert.match(duplicateItem, /semantic duplicate/i);
  assert.equal(
    achievements.find((achievement) => achievement.title === "Weekly Rhythm")
      ?.progress?.current,
    1,
  );
  assert.equal(
    achievements.filter((achievement) => achievement.title === "On-Time Finish")
      .length,
    2,
  );
  assert.equal(snapshot.rewards.length, 2);
  assert.equal(snapshot.companion.xp, 410);
  assert.equal(snapshot.companion.mood, "happy");
  assert.equal(snapshot.companion.message, "Pip is happy about your progress.");
});
