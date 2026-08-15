import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
  createFixtureSnapshot,
} from "./fixture-client";
import { createPalProgressionState } from "./progression";

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

  assert.match(serialized, /reward-mystery-egg-v1\.png/);
  assert.doesNotMatch(serialized, /Cloud Blanket/);
  assert.doesNotMatch(serialized, /reward-cloud-blanket-v1\.png/);
  assert.doesNotMatch(serialized, /Meet Pip/);
  assert.doesNotMatch(serialized, /assets\/pets\/default\.png/);
  assert.doesNotMatch(serialized, /Brave Beginner/);
});

test("fixture rebuilds deterministic story plans for different term lengths", () => {
  const client = createFixturePalClient(createFixtureSnapshot(4, 12));
  assert.equal(client.peek().roadmap.weeks.length, 12);
  assert.equal(client.peek().progression?.collectibles.length, 12);
  assert.deepEqual(client.peek().progression?.companionReveal, {
    status: "locked",
    label: "Mystery companion. Complete Week 4 to meet Pip.",
    assetUrl: "/assets/world/reward-mystery-egg-v1.png",
  });

  client.setTermWeeks?.(20);
  assert.equal(client.peek().roadmap.weeks.length, 20);
  assert.equal(client.peek().progression?.collectibles.length, 20);
  assert.equal(client.peek().progression?.storyTotalPeriods, 20);
  assert.throws(() => client.setTermWeeks?.(25), /6–24/);
});

test("fixture reset preserves the selected term length", () => {
  const client = createFixturePalClient();

  client.setTermWeeks?.(6);
  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  client.dispatch("reset");

  assert.equal(client.peek().roadmap.weeks.length, 6);
  assert.equal(client.peek().progression?.collectibles.length, 6);
  assert.equal(client.peek().progression?.storyTotalPeriods, 6);
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

test("fixture actions refresh titles derived from earned achievements", async () => {
  const client = createFixturePalClient();

  client.dispatch("on-time-finish");
  const title = (await client.getSnapshot()).progression?.titles.find(
    (candidate) => candidate.id === "on-time-pro",
  );

  assert.equal(title?.status, "earned");
});

test("a later behavior title replaces an earlier story title", () => {
  const client = createFixturePalClient(createFixtureSnapshot(4));

  assert.equal(client.peek().progression?.currentTitle, "Gentle Keeper");
  client.dispatch("on-time-finish", { itemToken: "later-title" });

  assert.equal(client.peek().progression?.currentTitle, "On-Time Pro");

  client.dispatch("classroom-joined");
  client.dispatch("advance-week");
  assert.equal(client.peek().progression?.currentTitle, "On-Time Pro");

  let completion = 1;
  while (client.peek().companion.level < 5) {
    completion += 1;
    client.dispatch("on-time-finish", {
      itemToken: `level-title-${completion}`,
    });
  }
  assert.equal(client.peek().progression?.currentTitle, "Level Leader");
});

test("a late completion crossing Level 5 displays Level Leader", () => {
  const snapshot = createFixtureSnapshot(4);
  snapshot.companion.level = 4;
  snapshot.companion.xp = 450;
  snapshot.companion.xpToNextLevel = 50;
  snapshot.progression = createPalProgressionState({
    currentWeek: snapshot.roadmap.currentWeek,
    totalWeeks: snapshot.roadmap.weeks.length,
    level: snapshot.companion.level,
    streak: snapshot.companion.streak,
    achievements: snapshot.roadmap.weeks.flatMap((week) => week.achievements),
    earnedWeeks: [1, 2, 3, 4],
  });
  const client = createFixturePalClient(snapshot);

  assert.equal(client.peek().progression?.currentTitle, "Gentle Keeper");
  client.dispatch("late-finish", { itemToken: "late-level-title" });

  assert.equal(client.peek().companion.level, 5);
  assert.equal(client.peek().progression?.currentTitle, "Level Leader");
});

test("fixture refreshes progression when a week or streak milestone changes", () => {
  const emptyClient = createFixturePalClient(createEmptyFixtureSnapshot());

  assert.equal(emptyClient.peek().progression?.companionReveal.status, "locked");
  emptyClient.dispatch("on-time-finish", { itemToken: "first-item" });
  assert.equal(emptyClient.peek().progression?.currentTitle, "On-Time Pro");

  emptyClient.dispatch("advance-week");
  emptyClient.dispatch("advance-week");
  emptyClient.dispatch("advance-week");
  for (let day = 1; day <= 4; day += 1) {
    emptyClient.dispatch("daily-log-completed", {
      activityDay: `2026-05-0${day}`,
    });
  }
  const weekProgression = emptyClient.peek().progression;

  assert.equal(weekProgression?.companionReveal.status, "earned");
  assert.equal(
    weekProgression?.collectibles.find(
      (collectible) => collectible.id === "pip-companion-v1",
    )?.status,
    "earned",
  );

  const streakSnapshot = createFixtureSnapshot(2);
  streakSnapshot.companion.streak = 2;
  streakSnapshot.progression = createPalProgressionState({
    currentWeek: streakSnapshot.roadmap.currentWeek,
    totalWeeks: streakSnapshot.roadmap.weeks.length,
    level: streakSnapshot.companion.level,
    streak: streakSnapshot.companion.streak,
    achievements: streakSnapshot.roadmap.weeks.flatMap(
      (week) => week.achievements,
    ),
  });
  const streakClient = createFixturePalClient(streakSnapshot);

  streakClient.dispatch("daily-log-completed");

  assert.equal(streakClient.peek().progression?.currentTitle, "Rhythm Builder");
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

test("earning Weekly Rhythm queues one story reveal with its collectible and title", () => {
  const client = createFixturePalClient(createFixtureSnapshot(3));

  client.dispatch("daily-log-completed", { activityDay: "2026-05-01" });
  client.dispatch("daily-log-completed", { activityDay: "2026-05-02" });

  const [reward] = client.peek().rewards;
  assert.equal(reward?.kind, "story");
  assert.equal(reward?.title, "Keep the light on");
  assert.equal(reward?.collectibleTitle, "Warming Lantern");
  assert.equal(reward?.assetUrl, "/assets/world/reward-warming-lantern-v1.png");
  assert.equal(reward?.titleAward, "Gentle Keeper");
  assert.equal(client.peek().progression?.currentTitle, "Gentle Keeper");
  assert.equal(
    client.peek().rewards.filter((candidate) => candidate.kind === "story").length,
    1,
  );
});

test("short-week completion queues the story reveal exactly once", () => {
  const client = createFixturePalClient(createFixtureSnapshot(4));

  client.dispatch("short-week-configured");
  client.dispatch("short-week-configured");

  const storyRewards = client.peek().rewards.filter(
    (candidate) => candidate.kind === "story",
  );
  assert.equal(storyRewards.length, 1);
  assert.equal(storyRewards[0]?.title, "Hello, Pip");
  assert.equal(storyRewards[0]?.collectibleTitle, "Meet Pip");
  assert.equal(client.peek().progression?.companionReveal.status, "earned");
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
  assert.equal(snapshot.companion.message, "Pip is happy about your progress.");
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
  assert.equal(progression?.currentTitle, "Level Leader");
  assert.equal(
    progression?.collectibles.some((reward) => reward.status === "earned"),
    false,
  );
});
