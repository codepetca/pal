import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
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

test("fixture projection redacts unearned story content and companion art", () => {
  const serialized = JSON.stringify(createFixtureSnapshot(2));

  assert.doesNotMatch(serialized, /\/assets\/world\/reward-/);
  assert.doesNotMatch(serialized, /Cloud Blanket/);
  assert.doesNotMatch(serialized, /reward-cloud-blanket-v1\.png/);
  assert.doesNotMatch(serialized, /Meet Pip/);
  assert.doesNotMatch(serialized, /\bPip\b/);
  assert.doesNotMatch(serialized, /assets\/pets\/default\.png/);
  assert.doesNotMatch(serialized, /Brave Beginner/);
});

test("fixture rebuilds concealed presentation slots for different term lengths", () => {
  const client = createFixturePalClient(createFixtureSnapshot(4, 12));
  assert.equal(client.peek().roadmap.weeks.length, 12);
  assert.equal(client.peek().progression?.collectibles.length, 12);
  assert.equal(client.peek().progression?.companionReveal.status, "locked");

  client.setTermWeeks?.(20);
  assert.equal(client.peek().roadmap.weeks.length, 20);
  assert.equal(client.peek().progression?.collectibles.length, 20);
  assert.throws(() => client.setTermWeeks?.(25), /6–24/);
});

test("fixture reset preserves the selected term length", () => {
  const client = createFixturePalClient();

  client.setTermWeeks?.(6);
  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  client.dispatch("reset");

  assert.equal(client.peek().roadmap.weeks.length, 6);
  assert.equal(client.peek().progression?.collectibles.length, 6);
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
  assert.equal(afterCompletion.companion.streak, 4);

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
  assert.equal(snapshot.companion.xp, 210);
  assert.equal(snapshot.companion.mood, "happy");
  assert.equal(
    snapshot.companion.message,
    "Your companion is happy about your progress.",
  );
});

test("fixture rewards Weekly Rhythm once and keeps its collection unlock", () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());
  for (const activityDay of [
    "2026-04-13",
    "2026-04-14",
    "2026-04-15",
    "2026-04-16",
  ]) {
    client.dispatch("daily-log-completed", { activityDay });
  }

  const earned = client.peek();
  assert.equal(earned.companion.xp, 115); // four logs + Weekly Rhythm
  assert.equal(earned.companion.mood, "excited");
  assert.deepEqual(
    earned.collection?.items.map((item) => item.id),
    ["world-study-bird-v1"],
  );

  client.dispatch("daily-log-completed", { activityDay: "2026-04-17" });
  const overLimit = client.dispatch("daily-log-completed", {
    activityDay: "2026-04-18",
  });
  assert.match(overLimit, /period limit exceeded/i);
  assert.equal(client.peek().companion.xp, 125);
  client.dispatch("advance-week");
  assert.equal(client.peek().companion.xp, 125);
  assert.deepEqual(
    client.peek().collection?.items.map((item) => item.id),
    ["world-study-bird-v1"],
  );
});

test("fixture pays distinct out-of-order days without moving the rhythm backward", () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());
  client.dispatch("daily-log-completed", { activityDay: "2026-04-14" });
  client.dispatch("daily-log-completed", { activityDay: "2026-04-13" });

  const snapshot = client.peek();
  assert.equal(snapshot.companion.xp, 20);
  assert.equal(snapshot.companion.streak, 1);
  assert.equal(
    snapshot.roadmap.weeks[0]?.achievements.find(
      (achievement) => achievement.title === "Weekly Rhythm",
    )?.progress?.current,
    2,
  );
});

test("fixture XP crosses production level thresholds without awarding story props", () => {
  const client = createFixturePalClient(createEmptyFixtureSnapshot());
  client.dispatch("advance-week");
  client.dispatch("advance-week");
  client.dispatch("advance-week");
  const thresholds = [
    { completions: 5, level: 2, xp: 0 },
    { completions: 10, level: 3, xp: 0 },
    { completions: 20, level: 5, xp: 0 },
    { completions: 25, level: 6, xp: 0 },
    { completions: 45, level: 10, xp: 0 },
  ];
  let completed = 0;

  for (const threshold of thresholds) {
    while (completed < threshold.completions) {
      completed += 1;
      client.dispatch("on-time-finish", { itemToken: `level-item-${completed}` });
    }
    const snapshot = client.peek();
    assert.equal(snapshot.companion.level, threshold.level);
    assert.equal(snapshot.companion.xp, threshold.xp);
    assert.equal(snapshot.companion.xpToNextLevel, 500 - threshold.xp);
  }

  const progression = client.peek().progression;
  assert.equal(
    progression?.collectibles.some((reward) => reward.status === "earned"),
    false,
  );
});
