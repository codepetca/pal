import type {
  PalAchievement,
  PalAchievementStatus,
  PalBadge,
  PalCollectibleKind,
  PalCollectibleUnlock,
  PalCompanionReveal,
  PalCompanionMood,
  PalCompanionState,
  PalCollectionItem,
  PalCollectionState,
  PalProgress,
  PalProgressionState,
  PalRewardNotice,
  PalRoadmapWeek,
  PalWeekStatus,
  PalWidgetSnapshot,
  PalTitleUnlock,
  PalUnlockStatus,
} from "./types";

const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;
const MAX_WEEKS = 64;
const MAX_ACHIEVEMENTS_PER_WEEK = 100;
const MAX_REWARDS = 100;
const MAX_COLLECTION_ITEMS = 50;
const MAX_COLLECTIBLES = 32;
const MAX_TITLES = 32;

export interface PalSnapshotValidationOptions {
  /**
   * Resolves root-relative asset paths. Its origin is automatically allowed.
   */
  assetBaseUrl?: string;
  /**
   * Additional explicit HTTPS asset origins, such as a Pal-owned CDN.
   */
  allowedAssetOrigins?: readonly string[];
}

interface AssetPolicy {
  allowedOrigins: Set<string>;
  baseUrl?: URL;
}

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

function secureAssetOrigin(url: URL, path: string): string {
  const localDevelopmentHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopmentHost)) {
    return fail(path, "expected an HTTPS origin (or HTTP localhost for development)");
  }
  return url.origin;
}

function createAssetPolicy(
  options: PalSnapshotValidationOptions,
): AssetPolicy {
  const allowedOrigins = new Set<string>();
  let baseUrl: URL | undefined;
  if (options.assetBaseUrl) {
    baseUrl = new URL(options.assetBaseUrl);
    allowedOrigins.add(
      secureAssetOrigin(baseUrl, "options.assetBaseUrl"),
    );
  }
  options.allowedAssetOrigins?.forEach((origin, index) => {
    const url = new URL(origin);
    if (url.origin !== url.toString().replace(/\/$/, "")) {
      fail(
        `options.allowedAssetOrigins[${index}]`,
        "expected an origin without a path, query, or fragment",
      );
    }
    allowedOrigins.add(
      secureAssetOrigin(url, `options.allowedAssetOrigins[${index}]`),
    );
  });
  return { allowedOrigins, baseUrl };
}

function optionalAssetUrl(
  value: unknown,
  path: string,
  policy: AssetPolicy,
): string | undefined {
  if (value === undefined) return undefined;
  const candidate = text(value, path, MAX_URL_LENGTH);
  if (candidate.includes("\\") || candidate.startsWith("//")) {
    return fail(
      path,
      "expected a root-relative or absolute asset URL without backslashes or a protocol-relative prefix",
    );
  }
  if (candidate.startsWith("/")) {
    if (!policy.baseUrl) return candidate;
    const url = new URL(candidate, policy.baseUrl);
    secureAssetOrigin(url, path);
    if (!policy.allowedOrigins.has(url.origin)) {
      return fail(path, "origin is not in the allowed Pal asset origin list");
    }
    return url.toString();
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail(path, "expected a root-relative or absolute asset URL");
  }
  secureAssetOrigin(url, path);
  if (!policy.allowedOrigins.has(url.origin)) {
    return fail(path, "origin is not in the allowed Pal asset origin list");
  }
  return url.toString();
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    return fail(path, `expected an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function optionalInteger(
  value: unknown,
  path: string,
  minimum = 0,
): number | undefined {
  return value === undefined ? undefined : integer(value, path, minimum);
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

function uniqueInteger(
  value: unknown,
  values: Set<number>,
  path: string,
  minimum: number,
): number {
  const parsed = integer(value, path, minimum);
  if (values.has(parsed)) {
    return fail(path, "expected a unique roadmap week");
  }
  values.add(parsed);
  return parsed;
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

function parseBadge(
  value: unknown,
  path: string,
  assetPolicy: AssetPolicy,
): PalBadge {
  const source = record(value, path);
  const icon = optionalText(source.icon, `${path}.icon`);
  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
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
  assetPolicy: AssetPolicy,
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
    badge: parseBadge(source.badge, `${path}.badge`, assetPolicy),
    ...(progress === undefined ? {} : { progress }),
    ...(rewardLabel === undefined ? {} : { rewardLabel }),
  };
}

function parseWeek(
  value: unknown,
  path: string,
  weekIds: Set<string>,
  weekNumbers: Set<number>,
  achievementIds: Set<string>,
  assetPolicy: AssetPolicy,
): PalRoadmapWeek {
  const source = record(value, path);
  return {
    id: uniqueId(text(source.id, `${path}.id`), weekIds, `${path}.id`),
    number: uniqueInteger(source.number, weekNumbers, `${path}.number`, 1),
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
        assetPolicy,
      ),
    ),
  };
}

function parseCompanion(
  value: unknown,
  path: string,
  assetPolicy: AssetPolicy,
): PalCompanionState {
  const source = record(value, path);
  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
  );
  const xp = optionalInteger(source.xp, `${path}.xp`);
  const xpToNextLevel = optionalInteger(
    source.xpToNextLevel,
    `${path}.xpToNextLevel`,
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
    ...(xp === undefined ? {} : { xp }),
    ...(xpToNextLevel === undefined ? {} : { xpToNextLevel }),
    message: text(source.message, `${path}.message`),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseReward(
  value: unknown,
  path: string,
  ids: Set<string>,
  assetPolicy: AssetPolicy,
): PalRewardNotice {
  const source = record(value, path);
  const icon = optionalText(source.icon, `${path}.icon`);
  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
  );
  const kind = source.kind === undefined
    ? undefined
    : member(source.kind, `${path}.kind`, ["standard", "story"] as const);
  const collectibleTitle = optionalText(
    source.collectibleTitle,
    `${path}.collectibleTitle`,
  );
  const titleAward = optionalText(source.titleAward, `${path}.titleAward`);
  const titleRevealCopy = optionalText(
    source.titleRevealCopy,
    `${path}.titleRevealCopy`,
  );
  return {
    id: uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`),
    title: text(source.title, `${path}.title`),
    description: text(source.description, `${path}.description`),
    ...(kind === undefined ? {} : { kind }),
    ...(collectibleTitle === undefined ? {} : { collectibleTitle }),
    ...(titleAward === undefined ? {} : { titleAward }),
    ...(titleRevealCopy === undefined ? {} : { titleRevealCopy }),
    ...(icon === undefined ? {} : { icon }),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseCollectionItem(
  value: unknown,
  path: string,
  ids: Set<string>,
  assetPolicy: AssetPolicy,
): PalCollectionItem {
  const source = record(value, path);
  const icon = optionalText(source.icon, `${path}.icon`);
  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
  );
  return {
    id: uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`),
    label: text(source.label, `${path}.label`),
    description: text(source.description, `${path}.description`),
    ...(icon === undefined ? {} : { icon }),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseCollection(
  value: unknown,
  path: string,
  assetPolicy: AssetPolicy,
): PalCollectionState {
  const source = record(value, path);
  const ids = new Set<string>();
  return {
    items: boundedArray(
      source.items,
      `${path}.items`,
      MAX_COLLECTION_ITEMS,
    ).map((item, index) =>
      parseCollectionItem(item, `${path}.items[${index}]`, ids, assetPolicy),
    ),
  };
}

function parseCollectible(
  value: unknown,
  path: string,
  ids: Set<string>,
  assignedRoadmapWeeks: Set<number>,
  validRoadmapWeeks: ReadonlySet<number>,
  assetPolicy: AssetPolicy,
): PalCollectibleUnlock {
  const source = record(value, path);
  const progress =
    source.progress === undefined
      ? undefined
      : parseProgress(source.progress, `${path}.progress`);
  const id = uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`);
  const status = member<PalUnlockStatus>(
    source.status,
    `${path}.status`,
    ["earned", "next", "locked"],
  );
  const statusLabel = text(source.statusLabel, `${path}.statusLabel`);
  const roadmapWeek = uniqueInteger(
    source.roadmapWeek,
    assignedRoadmapWeeks,
    `${path}.roadmapWeek`,
    1,
  );
  if (!validRoadmapWeeks.has(roadmapWeek)) {
    fail(`${path}.roadmapWeek`, "must identify a supplied roadmap week");
  }
  if (status !== "earned") {
    const concealedFields = [
      "chapterId",
      "title",
      "description",
      "revealHeadline",
      "storyCopy",
      "titleAward",
      "titleRevealCopy",
      "kind",
      "assetUrl",
    ];
    if (concealedFields.some((field) => source[field] !== undefined)) {
      fail(path, "expected concealed collectible content while locked");
    }
    return {
      id,
      roadmapWeek,
      status,
      statusLabel,
      ...(progress === undefined ? {} : { progress }),
    };
  }

  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
  );
  if (assetUrl === undefined) fail(`${path}.assetUrl`, "expected an asset URL");
  const chapterId = optionalText(source.chapterId, `${path}.chapterId`);
  const revealHeadline = optionalText(
    source.revealHeadline,
    `${path}.revealHeadline`,
  );
  const storyCopy = optionalText(source.storyCopy, `${path}.storyCopy`);
  const titleAward = optionalText(source.titleAward, `${path}.titleAward`);
  const titleRevealCopy = optionalText(
    source.titleRevealCopy,
    `${path}.titleRevealCopy`,
  );
  return {
    id,
    ...(chapterId === undefined ? {} : { chapterId }),
    title: text(source.title, `${path}.title`),
    description: text(source.description, `${path}.description`),
    ...(revealHeadline === undefined ? {} : { revealHeadline }),
    ...(storyCopy === undefined ? {} : { storyCopy }),
    ...(titleAward === undefined ? {} : { titleAward }),
    ...(titleRevealCopy === undefined ? {} : { titleRevealCopy }),
    roadmapWeek,
    kind: member<PalCollectibleKind>(
      source.kind,
      `${path}.kind`,
      ["companion", "room", "cosmetic"],
    ),
    status,
    statusLabel,
    assetUrl,
    ...(progress === undefined ? {} : { progress }),
  };
}

function parseTitle(
  value: unknown,
  path: string,
  ids: Set<string>,
): PalTitleUnlock {
  const source = record(value, path);
  const id = uniqueId(text(source.id, `${path}.id`), ids, `${path}.id`);
  const status = member<PalUnlockStatus>(
    source.status,
    `${path}.status`,
    ["earned", "next", "locked"],
  );
  const statusLabel = text(source.statusLabel, `${path}.statusLabel`);
  if (status !== "earned") {
    if (source.label !== undefined || source.description !== undefined) {
      fail(path, "expected concealed title content while locked");
    }
    return { id, status, statusLabel };
  }
  return {
    id,
    label: text(source.label, `${path}.label`),
    description: text(source.description, `${path}.description`),
    status,
    statusLabel,
  };
}

function parseCompanionReveal(
  value: unknown,
  path: string,
  assetPolicy: AssetPolicy,
): PalCompanionReveal {
  const source = record(value, path);
  const status = member<PalCompanionReveal["status"]>(
    source.status,
    `${path}.status`,
    ["earned", "locked"],
  );
  const assetUrl = optionalAssetUrl(
    source.assetUrl,
    `${path}.assetUrl`,
    assetPolicy,
  );
  if (status === "earned") {
    if (source.label !== undefined) {
      fail(`${path}.label`, "expected no locked label after reveal");
    }
    if (assetUrl === undefined) {
      fail(`${path}.assetUrl`, "expected earned companion artwork");
    }
    return { status, assetUrl };
  }
  return {
    status,
    label: text(source.label, `${path}.label`),
    ...(assetUrl === undefined ? {} : { assetUrl }),
  };
}

function parseProgression(
  value: unknown,
  path: string,
  validRoadmapWeeks: ReadonlySet<number>,
  roadmapPeriodCount: number,
  assetPolicy: AssetPolicy,
): PalProgressionState {
  const source = record(value, path);
  const collectibleIds = new Set<string>();
  const collectibleRoadmapWeeks = new Set<number>();
  const titleIds = new Set<string>();
  const storyId = optionalText(source.storyId, `${path}.storyId`);
  const storyVersion = optionalInteger(
    source.storyVersion,
    `${path}.storyVersion`,
    1,
  );
  const storyTotalPeriods = optionalInteger(
    source.storyTotalPeriods,
    `${path}.storyTotalPeriods`,
    1,
  );
  if (
    storyTotalPeriods !== undefined &&
    storyTotalPeriods !== roadmapPeriodCount
  ) {
    fail(`${path}.storyTotalPeriods`, "must match the roadmap period count");
  }
  const currentTitle = optionalText(source.currentTitle, `${path}.currentTitle`);
  if (
    source.companionUnlocked !== undefined ||
    source.companionUnlockWeek !== undefined
  ) {
    fail(path, "expected one canonical companionReveal decision");
  }
  return {
    ...(storyId === undefined ? {} : { storyId }),
    ...(storyVersion === undefined ? {} : { storyVersion }),
    ...(storyTotalPeriods === undefined ? {} : { storyTotalPeriods }),
    companionReveal: parseCompanionReveal(
      source.companionReveal,
      `${path}.companionReveal`,
      assetPolicy,
    ),
    ...(currentTitle === undefined ? {} : { currentTitle }),
    collectibles: boundedArray(
      source.collectibles,
      `${path}.collectibles`,
      MAX_COLLECTIBLES,
      1,
    ).map((collectible, index) =>
      parseCollectible(
        collectible,
        `${path}.collectibles[${index}]`,
        collectibleIds,
        collectibleRoadmapWeeks,
        validRoadmapWeeks,
        assetPolicy,
      ),
    ),
    titles: boundedArray(
      source.titles,
      `${path}.titles`,
      MAX_TITLES,
      0,
    ).map((title, index) =>
      parseTitle(title, `${path}.titles[${index}]`, titleIds),
    ),
  };
}

/**
 * Structurally validates network JSON before it reaches React state. Pal's
 * authenticated snapshot projector remains authoritative for story awards and
 * reveal eligibility; the widget intentionally does not re-run those rules.
 */
export function parsePalWidgetSnapshot(
  value: unknown,
  options: PalSnapshotValidationOptions = {},
): PalWidgetSnapshot {
  const source = record(value, "snapshot");
  const assetPolicy = createAssetPolicy(options);
  if (source.schemaVersion !== 1) {
    fail("snapshot.schemaVersion", "expected supported schema version 1");
  }

  const roadmap = record(source.roadmap, "snapshot.roadmap");
  const weekIds = new Set<string>();
  const weekNumbers = new Set<number>();
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
      weekNumbers,
      achievementIds,
      assetPolicy,
    ),
  );
  if (weeks.some((week) => week.number > weeks.length)) {
    fail(
      "snapshot.roadmap.weeks",
      "week numbers must form the contiguous range 1 through the roadmap length",
    );
  }
  const currentWeek = integer(
    roadmap.currentWeek,
    "snapshot.roadmap.currentWeek",
    1,
  );
  if (!weeks.some((week) => week.number === currentWeek)) {
    fail("snapshot.roadmap.currentWeek", "must identify a supplied roadmap week");
  }

  const rewardIds = new Set<string>();
  const collection =
    source.collection === undefined
      ? undefined
      : parseCollection(source.collection, "snapshot.collection", assetPolicy);
  const progression =
    source.progression === undefined
      ? undefined
      : parseProgression(
          source.progression,
          "snapshot.progression",
          weekNumbers,
          weeks.length,
          assetPolicy,
        );
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
    companion: parseCompanion(
      source.companion,
      "snapshot.companion",
      assetPolicy,
    ),
    ...(collection === undefined ? {} : { collection }),
    rewards: boundedArray(
      source.rewards,
      "snapshot.rewards",
      MAX_REWARDS,
    ).map((reward, index) =>
      parseReward(
        reward,
        `snapshot.rewards[${index}]`,
        rewardIds,
        assetPolicy,
      ),
    ),
    ...(progression === undefined ? {} : { progression }),
  };
}
