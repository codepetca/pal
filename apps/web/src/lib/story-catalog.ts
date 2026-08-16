import type { PalCollectibleKind } from "@codepet/pal-widget";

export const MIN_STORY_PERIODS = 6;
export const MAX_STORY_PERIODS = 24;
export const PIP_STORY_ID = "pips-first-recipe";
export const PIP_STORY_VERSION = 1;

export interface StoryReference {
  storyId: string;
  version: number;
}

export interface StoryRelease {
  eligibleFromTermStartDay: string;
  story: StoryReference;
}

export interface StoryTitleDefinition {
  id: string;
  label: string;
  description: string;
  revealCopy: string;
}

export interface StoryChapterDefinition {
  id: string;
  act: number;
  kind: "core" | "optional";
  revealHeadline: string;
  storyCopy: string;
  collectible: {
    id: string;
    title: string;
    kind: PalCollectibleKind;
    assetUrl: string;
  };
  title?: StoryTitleDefinition;
}

export interface PlannedStoryChapter extends StoryChapterDefinition {
  roadmapWeek: number;
  sourceChapterIds: readonly string[];
}

export interface StoryPlanDefinition extends StoryReference {
  totalPeriods: number;
  companionCollectibleId: string;
  mysteryCollectibleId: string;
  chapters: readonly PlannedStoryChapter[];
}

export interface StoryCatalog extends StoryReference {
  minPeriods: number;
  maxPeriods: number;
  companionCollectibleId: string;
  mysteryCollectibleId: string;
  chapters: readonly StoryChapterDefinition[];
  resolveChapter(chapterId: string): StoryChapterDefinition | undefined;
  createPlan(totalPeriods: number): StoryPlanDefinition;
}

type ChapterRow = readonly [
  id: string,
  act: number,
  kind: "core" | "optional",
  revealHeadline: string,
  storyCopy: string,
  collectibleId: string,
  collectibleTitle: string,
  assetUrl: string,
  collectibleKind?: PalCollectibleKind,
  title?: readonly [string, string, string, string],
];

const CHAPTER_ROWS: readonly ChapterRow[] = [
  ["egg-arrives", 1, "core", "Something found you", "After the storm, a small golden egg rolled into the light. You made room for it before you knew who was inside.", "mystery-egg-v1", "Mystery Egg", "/assets/world/reward-mystery-egg-v1.png", "companion"],
  ["soft-nest", 1, "optional", "A softer place", "The shell felt cold, so you tucked a cloud-soft blanket around it. The egg settled with a tiny sigh.", "cloud-blanket-v1", "Cloud Blanket", "/assets/world/reward-cloud-blanket-v1.png"],
  ["tiny-sound", 1, "optional", "Did you hear that?", "Something tapped from inside. You hung a little star above the nest and listened.", "star-mobile-v1", "Star Mobile", "/assets/world/reward-star-mobile-v1.png"],
  ["room-ready", 1, "optional", "Room for someone new", "You found a cushion for whoever might hatch. Waiting felt easier when there was a place ready.", "cat-cushion-v1", "Cozy Cushion", "/assets/world/reward-cat-cushion-v1.png"],
  ["first-sprout", 1, "optional", "Growing together", "A green shoot appeared beside the egg. You watered it, and both small things kept growing.", "star-plant-v1", "Star Sprout", "/assets/world/reward-star-plant-v1.png"],
  ["long-night", 1, "core", "Keep the light on", "The coldest night arrived. You left the lantern glowing until morning.", "warming-lantern-v1", "Warming Lantern", "/assets/world/reward-warming-lantern-v1.png", "room", ["gentle-keeper", "Gentle Keeper", "You stayed when Pip needed warmth.", "Pip remembers who kept the light on."]],
  ["pip-hatches", 1, "core", "Hello, Pip", "At sunrise, the shell opened. Pip blinked at the room—and found you still there.", "pip-companion-v1", "Meet Pip", "/assets/pets/default.png", "companion"],
  ["food-videos", 2, "optional", "One more video…", "Pip discovered cooking videos and watched far too many. One tiny recipe made Pip sit up.", "tiny-phone-v1", "Tiny Phone", "/assets/world/reward-tiny-phone-v1.png"],
  ["empty-cupboard", 2, "optional", "First, a plan", "The cupboard was almost empty. Pip packed a bag and made a plan.", "grocery-tote-v1", "Grocery Tote", "/assets/world/reward-grocery-tote-v1.png"],
  ["choose-ingredients", 2, "optional", "Just what we need", "There were dozens of tempting ingredients. Pip chose only what the recipe needed.", "ingredient-jars-v1", "Ingredient Jars", "/assets/world/reward-ingredient-jars-v1.png"],
  ["chef-scarf", 2, "optional", "Dressed for courage", "Pip was nervous, so the scarf became a chef's scarf for the day.", "star-scarf-v1", "Starlight Scarf", "/assets/world/reward-star-scarf-v1.png", "cosmetic"],
  ["recipe-chosen", 2, "core", "Pip has a plan", "Pip copied the recipe carefully. “I think I can try,” Pip said.", "recipe-card-v1", "Recipe Card", "/assets/world/reward-recipe-card-v1.png", "room", ["brave-beginner", "Brave Beginner", "You helped Pip begin before everything felt certain.", "Starting before you feel ready is its own kind of brave."]],
  ["flour-storm", 3, "optional", "Flour everywhere", "The first stir sent flour across the room. Pip's whiskers turned white.", "mixing-bowl-v1", "Mixing Bowl", "/assets/world/reward-mixing-bowl-v1.png"],
  ["measure-carefully", 3, "optional", "A better measure", "Paws were not measuring cups, Pip learned. The little spoons were much more reliable.", "measuring-spoons-v1", "Measuring Spoons", "/assets/world/reward-measuring-spoons-v1.png"],
  ["waiting-is-hard", 3, "optional", "Let the timer remember", "Pip checked the oven every ten seconds. The timer promised it would remember.", "kitchen-timer-v1", "Kitchen Timer", "/assets/world/reward-kitchen-timer-v1.png"],
  ["burnt-batch", 3, "core", "The first try", "The first batch came out dark and hard. Pip sat very still beside it. You sat there too.", "wooden-spoon-v1", "Wooden Spoon", "/assets/world/reward-wooden-spoon-v1.png"],
  ["keep-the-pan", 3, "optional", "Tomorrow's pan", "Pip wanted to throw the pan away. Instead, Pip washed it and set it out for tomorrow.", "star-pan-v1", "Star Pan", "/assets/world/reward-star-pan-v1.png"],
  ["second-try", 3, "core", "Pip did it", "The next batch rose, golden and warm. Pip took the smallest bite, then the biggest smile appeared.", "moon-snack-plate-v1", "Moon Snack Plate", "/assets/world/reward-moon-snack-plate-v1.png", "room", ["try-again-chef", "Try-Again Chef", "You stayed for another attempt.", "Trying again changed the ending."]],
  ["flicker-outside", 4, "optional", "A flicker outside", "A pale flicker appeared beyond the window. Whenever Pip looked up, it disappeared.", "moon-window-charm-v1", "Moon Window Charm", "/assets/world/reward-moon-window-charm-v1.png"],
  ["gentle-invitation", 4, "optional", "An invitation", "Pip drew a small moon and left it outside. An invitation, not a chase.", "little-invitation-v1", "Little Invitation", "/assets/world/reward-little-invitation-v1.png"],
  ["waiting-gently", 4, "optional", "Waiting gently", "Pip waited with two empty places on the blanket. Nothing happened—and that was okay.", "picnic-blanket-v1", "Picnic Blanket", "/assets/world/reward-picnic-blanket-v1.png"],
  ["share-the-snacks", 4, "core", "Half for someone else", "Pip left half the moon snacks in a little bowl. By morning, one was gone.", "sharing-bowl-v1", "Sharing Bowl", "/assets/world/reward-sharing-bowl-v1.png"],
  ["recipe-for-two", 4, "optional", "For two", "Pip wrote the recipe down neatly. At the top of the page: “For two.”", "pip-cookbook-v1", "Pip's Cookbook", "/assets/world/reward-pip-cookbook-v1.png"],
  ["lumi-returns", 4, "core", "Hello, Lumi", "That evening, Lumi returned and stayed. The safest place Pip knew had become big enough for a friend.", "lumi-companion-v1", "Meet Lumi", "/assets/pets/lumi-v1.png", "companion", ["true-friend", "True Friend", "Pip found the courage to make room for someone else.", "Care has a way of making more room."]],
];

const chapters = CHAPTER_ROWS.map((row): StoryChapterDefinition => ({
  id: row[0],
  act: row[1],
  kind: row[2],
  revealHeadline: row[3],
  storyCopy: row[4],
  collectible: {
    id: row[5],
    title: row[6],
    assetUrl: row[7],
    kind: row[8] ?? "room",
  },
  ...(row[9]
    ? {
        title: {
          id: row[9][0],
          label: row[9][1],
          description: row[9][2],
          revealCopy: row[9][3],
        },
      }
    : {}),
}));
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));

function requireChapter(id: string): StoryChapterDefinition {
  const chapter = chapterById.get(id);
  if (!chapter) throw new Error(`Unknown Pip story chapter: ${id}`);
  return chapter;
}

function mergedOpening(): StoryChapterDefinition & { sourceChapterIds: readonly string[] } {
  return {
    ...requireChapter("egg-arrives"),
    id: "egg-and-light",
    revealHeadline: "Keep the light on",
    storyCopy: "After the storm, a small golden egg rolled into the light. You kept it warm until morning.",
    title: requireChapter("long-night").title,
    sourceChapterIds: ["egg-arrives", "long-night"],
  };
}

function mergedFinale(): StoryChapterDefinition & { sourceChapterIds: readonly string[] } {
  return {
    ...requireChapter("lumi-returns"),
    id: "snacks-and-lumi",
    revealHeadline: "Hello, Lumi",
    storyCopy: "Pip left half the moon snacks outside. That evening, Lumi returned—and stayed.",
    sourceChapterIds: ["share-the-snacks", "lumi-returns"],
  };
}

function resolvePipChapter(chapterId: string): StoryChapterDefinition | undefined {
  if (chapterId === "egg-and-light") return mergedOpening();
  if (chapterId === "snacks-and-lumi") return mergedFinale();
  return chapterById.get(chapterId);
}

const CORE_IDS = chapters.filter((chapter) => chapter.kind === "core").map((chapter) => chapter.id);
const OPTIONAL_PRIORITY = {
  1: ["soft-nest", "room-ready", "tiny-sound", "first-sprout"],
  2: ["food-videos", "empty-cupboard", "choose-ingredients", "chef-scarf"],
  3: ["flour-storm", "keep-the-pan", "measure-carefully", "waiting-is-hard"],
  4: ["flicker-outside", "gentle-invitation", "waiting-gently", "recipe-for-two"],
} as const;
const OPTIONAL_ACT_ORDER = [3, 4, 2, 1, 3, 4, 3, 4, 1, 2, 1, 2, 1, 2, 3, 4] as const;

function planned(source: readonly (StoryChapterDefinition & { sourceChapterIds?: readonly string[] })[]): readonly PlannedStoryChapter[] {
  return source.map((chapter, index) => ({
    ...chapter,
    roadmapWeek: index + 1,
    sourceChapterIds: chapter.sourceChapterIds ?? [chapter.id],
  }));
}

function createPipPlan(totalPeriods: number): StoryPlanDefinition {
  if (!Number.isInteger(totalPeriods) || totalPeriods < MIN_STORY_PERIODS || totalPeriods > MAX_STORY_PERIODS) {
    throw new Error(`Pip's First Recipe supports ${MIN_STORY_PERIODS}–${MAX_STORY_PERIODS} instructional periods`);
  }
  let selectedChapters: readonly (StoryChapterDefinition & { sourceChapterIds?: readonly string[] })[];
  if (totalPeriods === 6) {
    selectedChapters = [mergedOpening(), requireChapter("pip-hatches"), requireChapter("recipe-chosen"), requireChapter("burnt-batch"), requireChapter("second-try"), mergedFinale()];
  } else if (totalPeriods === 7) {
    selectedChapters = [mergedOpening(), requireChapter("pip-hatches"), requireChapter("recipe-chosen"), requireChapter("burnt-batch"), requireChapter("second-try"), requireChapter("share-the-snacks"), requireChapter("lumi-returns")];
  } else {
    const selected = new Set(CORE_IDS);
    const byAct: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (let index = 0; index < totalPeriods - CORE_IDS.length; index += 1) {
      const act = OPTIONAL_ACT_ORDER[index];
      if (!act) throw new Error("Pip story optional schedule is incomplete");
      const chapterId = OPTIONAL_PRIORITY[act][byAct[act]];
      if (!chapterId) throw new Error(`Pip story Act ${act} has no optional chapter available`);
      selected.add(chapterId);
      byAct[act] += 1;
    }
    selectedChapters = chapters.filter((chapter) => selected.has(chapter.id));
  }
  return {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
    totalPeriods,
    companionCollectibleId: "pip-companion-v1",
    mysteryCollectibleId: "mystery-egg-v1",
    chapters: planned(selectedChapters),
  };
}

export const STORY_TITLE_CHAPTER_IDS = deepFreeze([
  ...new Set(
    Array.from(
      { length: MAX_STORY_PERIODS - MIN_STORY_PERIODS + 1 },
      (_, index) => createPipPlan(MIN_STORY_PERIODS + index).chapters,
    )
      .flat()
      .filter((chapter) => chapter.title)
      .map((chapter) => chapter.id),
  ),
]);

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export interface StoryRegistry {
  getCatalog(reference: StoryReference): StoryCatalog | undefined;
  requireCatalog(reference: StoryReference): StoryCatalog;
  createPlan(totalPeriods: number, reference: StoryReference): StoryPlanDefinition;
  resolveChapter(reference: StoryReference, chapterId: string): StoryChapterDefinition | undefined;
  resolveTitle(titleId: string): StoryTitleDefinition | undefined;
}

function storyKey(reference: StoryReference): string {
  return `${reference.storyId}@${reference.version}`;
}

export function createStoryRegistry(catalogs: readonly StoryCatalog[]): StoryRegistry {
  const byKey = new Map<string, StoryCatalog>();
  const titles = new Map<string, StoryTitleDefinition>();
  for (const candidate of catalogs) {
    if (byKey.has(storyKey(candidate))) throw new Error(`Duplicate story catalog: ${storyKey(candidate)}`);
    const catalog = deepFreeze(candidate);
    byKey.set(storyKey(catalog), catalog);
    for (const chapter of catalog.chapters) {
      if (chapter.title) {
        if (titles.has(chapter.title.id)) throw new Error(`Duplicate story title: ${chapter.title.id}`);
        titles.set(chapter.title.id, chapter.title);
      }
    }
    for (let periods = catalog.minPeriods; periods <= catalog.maxPeriods; periods += 1) {
      const plan = catalog.createPlan(periods);
      if (plan.chapters.length !== periods || plan.chapters.some((chapter, index) => chapter.roadmapWeek !== index + 1)) {
        throw new Error(`Story catalog ${storyKey(catalog)} must return one contiguous chapter per period`);
      }
    }
  }
  const getCatalog = (reference: StoryReference) => byKey.get(storyKey(reference));
  return deepFreeze({
    getCatalog,
    requireCatalog(reference: StoryReference) {
      const catalog = getCatalog(reference);
      if (!catalog) throw new Error(`Unsupported story catalog: ${storyKey(reference)}`);
      return catalog;
    },
    createPlan(totalPeriods: number, reference: StoryReference) {
      return deepFreeze(this.requireCatalog(reference).createPlan(totalPeriods));
    },
    resolveChapter(reference: StoryReference, chapterId: string) {
      return getCatalog(reference)?.resolveChapter(chapterId);
    },
    resolveTitle(titleId: string) {
      return titles.get(titleId);
    },
  });
}

const pipCatalog: StoryCatalog = {
  storyId: PIP_STORY_ID,
  version: PIP_STORY_VERSION,
  minPeriods: MIN_STORY_PERIODS,
  maxPeriods: MAX_STORY_PERIODS,
  companionCollectibleId: "pip-companion-v1",
  mysteryCollectibleId: "mystery-egg-v1",
  chapters,
  resolveChapter(chapterId: string) {
    const chapter = resolvePipChapter(chapterId);
    return chapter ? deepFreeze(chapter) : undefined;
  },
  createPlan(totalPeriods: number) {
    return deepFreeze(createPipPlan(totalPeriods));
  },
};

export const STORY_REGISTRY = createStoryRegistry([pipCatalog]);

function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function createStoryReleaseSchedule(
  releases: readonly StoryRelease[],
  registry: Pick<StoryRegistry, "requireCatalog"> = STORY_REGISTRY,
): readonly StoryRelease[] {
  if (releases.length === 0) throw new Error("Story release schedule cannot be empty");
  let previousDay: string | undefined;
  const schedule = releases.map((release) => {
    if (!isCalendarDay(release.eligibleFromTermStartDay)) {
      throw new Error(`Invalid story release day: ${release.eligibleFromTermStartDay}`);
    }
    if (previousDay !== undefined && release.eligibleFromTermStartDay <= previousDay) {
      throw new Error("Story release days must be unique and strictly increasing");
    }
    registry.requireCatalog(release.story);
    previousDay = release.eligibleFromTermStartDay;
    return {
      eligibleFromTermStartDay: release.eligibleFromTermStartDay,
      story: { ...release.story },
    };
  });
  return deepFreeze(schedule);
}

export function selectStoryForTermStartDay(
  termStartDay: string,
  schedule: readonly StoryRelease[],
): StoryReference {
  if (!isCalendarDay(termStartDay)) throw new Error(`Invalid term start day: ${termStartDay}`);
  const release = schedule.reduce<StoryRelease | undefined>((selected, candidate) => {
    if (candidate.eligibleFromTermStartDay > termStartDay) return selected;
    return !selected ||
      candidate.eligibleFromTermStartDay > selected.eligibleFromTermStartDay
      ? candidate
      : selected;
  }, undefined);
  if (!release) throw new Error("No story release is eligible for this term start");
  return release.story;
}

export const STORY_RELEASE_SCHEDULE = createStoryReleaseSchedule([
  {
    eligibleFromTermStartDay: "0001-01-01",
    story: { storyId: PIP_STORY_ID, version: PIP_STORY_VERSION },
  },
] as const);

export function storyForTermStartDay(termStartDay: string): StoryReference {
  return selectStoryForTermStartDay(termStartDay, STORY_RELEASE_SCHEDULE);
}
