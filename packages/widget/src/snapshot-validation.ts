import type {
  PalAchievement,
  PalAchievementStatus,
  PalBadge,
  PalCompanionMood,
  PalCompanionState,
  PalProgress,
  PalRewardNotice,
  PalRoadmapWeek,
  PalWeekStatus,
  PalWidgetSnapshot,
} from "./types";

const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;
const MAX_WEEKS = 64;
const MAX_ACHIEVEMENTS_PER_WEEK = 100;
const MAX_REWARDS = 100;

function fail(path: string, expectation: string): never {
  throw new Error(`Invalid Pal widget snapshot at ${path}: ${expectation}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  path: string,
  maxLength = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string" || value.length > maxLength) {
    return fail(path, `expected a string of at most ${maxLength} characters`);
  }
  return value;
}

function optionalText(
  value: unknown,
  path: string,
  maxLength = MAX_TEXT_LENGTH,
): string | undefined {
  return value === undefined ? undefined : text(value, path, maxLength);
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    return fail(path, `expected an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function member<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    return fail(
      path,
      `expected an array with ${minimum} to ${maximum} entries`,
    );
  }
  return value;
}

function uniqueId(id: string, ids: Set<string>, path: string): string {
  if (ids.has(id)) {
    return fail(path, "expected a unique id");
  }
  ids.add(id);
  return id;
}

function parseProgress(value: unknown, path: string): PalProgress {
  const source = record(value, path);
  const target = integer(source.target, `${path}.target`, 1);
  const current = integer(source.current, `${path}.current`);
  if (current > target) {
    fail(`${path}.current`, "must not exceed target");
  }
  return {
    current,
    target,
    label: text(source.label, `${path}.label`),
  };
}

function parseBadge(value: unknown, path: string): PalBadge {
  const source = record(value, path);
  const icon = optionalText(source.icon, `${path}.icon`);
  const assetUrl = optionalText(
    source.assetUrl,
    `${path}.assetUrl`,
    MAX_URL_LENGTH,
  );
  return {
    label: text(source.label, `${path}.label`),
    ...(icon === undefined ? {} : { icon }),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseAchievement(
  value: unknown,
  path: string,
  ids: Set<string>,
): PalAchievement {
  const source = record(value, path);
  const progress =
    source.progress === undefined
      ? undefined
      : parseProgress(source.progress, `${path}.progress`);
  const rewardLabel = optionalText(source.rewardLabel, `${path}.rewardLabel`);
  return {
    id: uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`),
    title: text(source.title, `${path}.title`),
    description: text(source.description, `${path}.description`),
    status: member<PalAchievementStatus>(
      source.status,
      `${path}.status`,
      ["earned", "in-progress", "incomplete", "upcoming"],
    ),
    statusLabel: text(source.statusLabel, `${path}.statusLabel`),
    badge: parseBadge(source.badge, `${path}.badge`),
    ...(progress === undefined ? {} : { progress }),
    ...(rewardLabel === undefined ? {} : { rewardLabel }),
  };
}

function parseWeek(
  value: unknown,
  path: string,
  weekIds: Set<string>,
  achievementIds: Set<string>,
): PalRoadmapWeek {
  const source = record(value, path);
  return {
    id: uniqueId(text(source.id, `${path}.id`), weekIds, `${path}.id`),
    number: integer(source.number, `${path}.number`, 1),
    label: text(source.label, `${path}.label`),
    dateLabel: text(source.dateLabel, `${path}.dateLabel`),
    status: member<PalWeekStatus>(
      source.status,
      `${path}.status`,
      ["past", "current", "future"],
    ),
    summary: text(source.summary, `${path}.summary`),
    achievements: boundedArray(
      source.achievements,
      `${path}.achievements`,
      MAX_ACHIEVEMENTS_PER_WEEK,
    ).map((achievement, index) =>
      parseAchievement(
        achievement,
        `${path}.achievements[${index}]`,
        achievementIds,
      ),
    ),
  };
}

function parseCompanion(value: unknown, path: string): PalCompanionState {
  const source = record(value, path);
  const assetUrl = optionalText(
    source.assetUrl,
    `${path}.assetUrl`,
    MAX_URL_LENGTH,
  );
  return {
    name: text(source.name, `${path}.name`),
    mood: member<PalCompanionMood>(
      source.mood,
      `${path}.mood`,
      ["neutral", "happy", "excited", "sleeping"],
    ),
    moodLabel: text(source.moodLabel, `${path}.moodLabel`),
    level: integer(source.level, `${path}.level`),
    streak: integer(source.streak, `${path}.streak`),
    message: text(source.message, `${path}.message`),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseReward(
  value: unknown,
  path: string,
  ids: Set<string>,
): PalRewardNotice {
  const source = record(value, path);
  const icon = optionalText(source.icon, `${path}.icon`);
  const assetUrl = optionalText(
    source.assetUrl,
    `${path}.assetUrl`,
    MAX_URL_LENGTH,
  );
  return {
    id: uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`),
    title: text(source.title, `${path}.title`),
    description: text(source.description, `${path}.description`),
    ...(icon === undefined ? {} : { icon }),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

/**
 * Validates the untrusted JSON returned by Pal before it reaches React state.
 */
export function parsePalWidgetSnapshot(value: unknown): PalWidgetSnapshot {
  const source = record(value, "snapshot");
  if (source.schemaVersion !== 1) {
    fail("snapshot.schemaVersion", "expected supported schema version 1");
  }

  const roadmap = record(source.roadmap, "snapshot.roadmap");
  const weekIds = new Set<string>();
  const achievementIds = new Set<string>();
  const weeks = boundedArray(
    roadmap.weeks,
    "snapshot.roadmap.weeks",
    MAX_WEEKS,
    1,
  ).map((week, index) =>
    parseWeek(
      week,
      `snapshot.roadmap.weeks[${index}]`,
      weekIds,
      achievementIds,
    ),
  );
  const currentWeek = integer(
    roadmap.currentWeek,
    "snapshot.roadmap.currentWeek",
    1,
  );
  if (!weeks.some((week) => week.number === currentWeek)) {
    fail("snapshot.roadmap.currentWeek", "must identify a supplied roadmap week");
  }

  const rewardIds = new Set<string>();
  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: text(
        roadmap.semesterLabel,
        "snapshot.roadmap.semesterLabel",
      ),
      currentWeek,
      weeks,
    },
    companion: parseCompanion(source.companion, "snapshot.companion"),
    rewards: boundedArray(
      source.rewards,
      "snapshot.rewards",
      MAX_REWARDS,
    ).map((reward, index) =>
      parseReward(reward, `snapshot.rewards[${index}]`, rewardIds),
    ),
  };
}
