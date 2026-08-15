import type { PalCollectibleKind } from "./types";

export const PIP_STORY_ID = "pips-first-recipe";
export const PIP_STORY_VERSION = 1;
export const MIN_STORY_PERIODS = 6;
export const MAX_STORY_PERIODS = 24;

export type PalStoryAct = 1 | 2 | 3 | 4;
export type PalStoryChapterKind = "core" | "optional";

export interface PalStoryTitleDefinition {
  id: string;
  label: string;
  description: string;
  revealCopy: string;
}

export interface PalStoryCollectibleDefinition {
  id: string;
  title: string;
  kind: PalCollectibleKind;
  assetUrl: string;
}

export interface PalStoryChapterDefinition {
  id: string;
  act: PalStoryAct;
  kind: PalStoryChapterKind;
  revealHeadline: string;
  storyCopy: string;
  collectible: PalStoryCollectibleDefinition;
  title?: PalStoryTitleDefinition;
}

export interface PalPlannedStoryChapter extends PalStoryChapterDefinition {
  roadmapWeek: number;
  sourceChapterIds: readonly string[];
}

export interface PalStoryPlan {
  storyId: typeof PIP_STORY_ID;
  version: typeof PIP_STORY_VERSION;
  totalPeriods: number;
  chapters: readonly PalPlannedStoryChapter[];
}

const title = (
  id: string,
  label: string,
  description: string,
  revealCopy: string,
): PalStoryTitleDefinition => ({ id, label, description, revealCopy });

const collectible = (
  id: string,
  title: string,
  assetUrl: string,
  kind: PalCollectibleKind = "room",
): PalStoryCollectibleDefinition => ({ id, title, kind, assetUrl });

/** Canonical 24-chapter catalog for the fully expanded story. */
export const PIP_STORY_CHAPTERS: readonly PalStoryChapterDefinition[] = [
  {
    id: "egg-arrives",
    act: 1,
    kind: "core",
    revealHeadline: "Something found you",
    storyCopy: "After the storm, a small golden egg rolled into the light. You made room for it before you knew who was inside.",
    collectible: collectible("mystery-egg-v1", "Mystery Egg", "/assets/world/reward-mystery-egg-v1.png", "companion"),
  },
  {
    id: "soft-nest",
    act: 1,
    kind: "optional",
    revealHeadline: "A softer place",
    storyCopy: "The shell felt cold, so you tucked a cloud-soft blanket around it. The egg settled with a tiny sigh.",
    collectible: collectible("cloud-blanket-v1", "Cloud Blanket", "/assets/world/reward-cloud-blanket-v1.png"),
  },
  {
    id: "tiny-sound",
    act: 1,
    kind: "optional",
    revealHeadline: "Did you hear that?",
    storyCopy: "Something tapped from inside. You hung a little star above the nest and listened.",
    collectible: collectible("star-mobile-v1", "Star Mobile", "/assets/world/reward-star-mobile-v1.png"),
  },
  {
    id: "room-ready",
    act: 1,
    kind: "optional",
    revealHeadline: "Room for someone new",
    storyCopy: "You found a cushion for whoever might hatch. Waiting felt easier when there was a place ready.",
    collectible: collectible("cat-cushion-v1", "Cozy Cushion", "/assets/world/reward-cat-cushion-v1.png"),
  },
  {
    id: "first-sprout",
    act: 1,
    kind: "optional",
    revealHeadline: "Growing together",
    storyCopy: "A green shoot appeared beside the egg. You watered it, and both small things kept growing.",
    collectible: collectible("star-plant-v1", "Star Sprout", "/assets/world/reward-star-plant-v1.png"),
  },
  {
    id: "long-night",
    act: 1,
    kind: "core",
    revealHeadline: "Keep the light on",
    storyCopy: "The coldest night arrived. You left the lantern glowing until morning.",
    collectible: collectible("warming-lantern-v1", "Warming Lantern", "/assets/world/reward-warming-lantern-v1.png"),
    title: title("gentle-keeper", "Gentle Keeper", "You stayed when Pip needed warmth.", "Pip remembers who kept the light on."),
  },
  {
    id: "pip-hatches",
    act: 1,
    kind: "core",
    revealHeadline: "Hello, Pip",
    storyCopy: "At sunrise, the shell opened. Pip blinked at the room—and found you still there.",
    collectible: collectible("pip-companion-v1", "Meet Pip", "/assets/pets/default.png", "companion"),
  },
  {
    id: "food-videos",
    act: 2,
    kind: "optional",
    revealHeadline: "One more video…",
    storyCopy: "Pip discovered cooking videos and watched far too many. One tiny recipe made Pip sit up.",
    collectible: collectible("tiny-phone-v1", "Tiny Phone", "/assets/world/reward-tiny-phone-v1.png"),
  },
  {
    id: "empty-cupboard",
    act: 2,
    kind: "optional",
    revealHeadline: "First, a plan",
    storyCopy: "The cupboard was almost empty. Pip packed a bag and made a plan.",
    collectible: collectible("grocery-tote-v1", "Grocery Tote", "/assets/world/reward-grocery-tote-v1.png"),
  },
  {
    id: "choose-ingredients",
    act: 2,
    kind: "optional",
    revealHeadline: "Just what we need",
    storyCopy: "There were dozens of tempting ingredients. Pip chose only what the recipe needed.",
    collectible: collectible("ingredient-jars-v1", "Ingredient Jars", "/assets/world/reward-ingredient-jars-v1.png"),
  },
  {
    id: "chef-scarf",
    act: 2,
    kind: "optional",
    revealHeadline: "Dressed for courage",
    storyCopy: "Pip was nervous, so the scarf became a chef's scarf for the day.",
    collectible: collectible("star-scarf-v1", "Starlight Scarf", "/assets/world/reward-star-scarf-v1.png", "cosmetic"),
  },
  {
    id: "recipe-chosen",
    act: 2,
    kind: "core",
    revealHeadline: "Pip has a plan",
    storyCopy: "Pip copied the recipe carefully. “I think I can try,” Pip said.",
    collectible: collectible("recipe-card-v1", "Recipe Card", "/assets/world/reward-recipe-card-v1.png"),
    title: title("brave-beginner", "Brave Beginner", "You helped Pip begin before everything felt certain.", "Starting before you feel ready is its own kind of brave."),
  },
  {
    id: "flour-storm",
    act: 3,
    kind: "optional",
    revealHeadline: "Flour everywhere",
    storyCopy: "The first stir sent flour across the room. Pip's whiskers turned white.",
    collectible: collectible("mixing-bowl-v1", "Mixing Bowl", "/assets/world/reward-mixing-bowl-v1.png"),
  },
  {
    id: "measure-carefully",
    act: 3,
    kind: "optional",
    revealHeadline: "A better measure",
    storyCopy: "Paws were not measuring cups, Pip learned. The little spoons were much more reliable.",
    collectible: collectible("measuring-spoons-v1", "Measuring Spoons", "/assets/world/reward-measuring-spoons-v1.png"),
  },
  {
    id: "waiting-is-hard",
    act: 3,
    kind: "optional",
    revealHeadline: "Let the timer remember",
    storyCopy: "Pip checked the oven every ten seconds. The timer promised it would remember.",
    collectible: collectible("kitchen-timer-v1", "Kitchen Timer", "/assets/world/reward-kitchen-timer-v1.png"),
  },
  {
    id: "burnt-batch",
    act: 3,
    kind: "core",
    revealHeadline: "The first try",
    storyCopy: "The first batch came out dark and hard. Pip sat very still beside it. You sat there too.",
    collectible: collectible("wooden-spoon-v1", "Wooden Spoon", "/assets/world/reward-wooden-spoon-v1.png"),
  },
  {
    id: "keep-the-pan",
    act: 3,
    kind: "optional",
    revealHeadline: "Tomorrow's pan",
    storyCopy: "Pip wanted to throw the pan away. Instead, Pip washed it and set it out for tomorrow.",
    collectible: collectible("star-pan-v1", "Star Pan", "/assets/world/reward-star-pan-v1.png"),
  },
  {
    id: "second-try",
    act: 3,
    kind: "core",
    revealHeadline: "Pip did it",
    storyCopy: "The next batch rose, golden and warm. Pip took the smallest bite, then the biggest smile appeared.",
    collectible: collectible("moon-snack-plate-v1", "Moon Snack Plate", "/assets/world/reward-moon-snack-plate-v1.png"),
    title: title("try-again-chef", "Try-Again Chef", "You stayed for another attempt.", "Trying again changed the ending."),
  },
  {
    id: "flicker-outside",
    act: 4,
    kind: "optional",
    revealHeadline: "A flicker outside",
    storyCopy: "A pale flicker appeared beyond the window. Whenever Pip looked up, it disappeared.",
    collectible: collectible("moon-window-charm-v1", "Moon Window Charm", "/assets/world/reward-moon-window-charm-v1.png"),
  },
  {
    id: "gentle-invitation",
    act: 4,
    kind: "optional",
    revealHeadline: "An invitation",
    storyCopy: "Pip drew a small moon and left it outside. An invitation, not a chase.",
    collectible: collectible("little-invitation-v1", "Little Invitation", "/assets/world/reward-little-invitation-v1.png"),
  },
  {
    id: "waiting-gently",
    act: 4,
    kind: "optional",
    revealHeadline: "Waiting gently",
    storyCopy: "Pip waited with two empty places on the blanket. Nothing happened—and that was okay.",
    collectible: collectible("picnic-blanket-v1", "Picnic Blanket", "/assets/world/reward-picnic-blanket-v1.png"),
  },
  {
    id: "share-the-snacks",
    act: 4,
    kind: "core",
    revealHeadline: "Half for someone else",
    storyCopy: "Pip left half the moon snacks in a little bowl. By morning, one was gone.",
    collectible: collectible("sharing-bowl-v1", "Sharing Bowl", "/assets/world/reward-sharing-bowl-v1.png"),
  },
  {
    id: "recipe-for-two",
    act: 4,
    kind: "optional",
    revealHeadline: "For two",
    storyCopy: "Pip wrote the recipe down neatly. At the top of the page: “For two.”",
    collectible: collectible("pip-cookbook-v1", "Pip's Cookbook", "/assets/world/reward-pip-cookbook-v1.png"),
  },
  {
    id: "lumi-returns",
    act: 4,
    kind: "core",
    revealHeadline: "Hello, Lumi",
    storyCopy: "That evening, Lumi returned and stayed. The safest place Pip knew had become big enough for a friend.",
    collectible: collectible("lumi-companion-v1", "Meet Lumi", "/assets/pets/lumi-v1.png", "companion"),
    title: title("true-friend", "True Friend", "Pip found the courage to make room for someone else.", "Care has a way of making more room."),
  },
] as const;

const BY_ID = new Map(PIP_STORY_CHAPTERS.map((chapter) => [chapter.id, chapter]));
const CORE_IDS = PIP_STORY_CHAPTERS
  .filter((chapter) => chapter.kind === "core")
  .map((chapter) => chapter.id);

const OPTIONAL_PRIORITY_BY_ACT: Readonly<Record<PalStoryAct, readonly string[]>> = {
  1: ["soft-nest", "room-ready", "tiny-sound", "first-sprout"],
  2: ["food-videos", "empty-cupboard", "choose-ingredients", "chef-scarf"],
  3: ["flour-storm", "keep-the-pan", "measure-carefully", "waiting-is-hard"],
  4: ["flicker-outside", "gentle-invitation", "waiting-gently", "recipe-for-two"],
};

// Keeps the emotional middle and final act roomy in common 12–16 week terms,
// while still including every optional chapter in the 24-period plan.
const OPTIONAL_ACT_ORDER: readonly PalStoryAct[] = [
  3, 4, 2, 1, 3, 4, 3, 4, 1, 2, 1, 2, 1, 2, 3, 4,
];

function requireChapter(id: string): PalStoryChapterDefinition {
  const chapter = BY_ID.get(id);
  if (!chapter) throw new Error(`Unknown Pip story chapter: ${id}`);
  return chapter;
}

function mergedOpening(): PalStoryChapterDefinition & { sourceChapterIds: readonly string[] } {
  return {
    ...requireChapter("egg-arrives"),
    id: "egg-and-light",
    revealHeadline: "Keep the light on",
    storyCopy: "After the storm, a small golden egg rolled into the light. You kept it warm until morning.",
    title: requireChapter("long-night").title,
    sourceChapterIds: ["egg-arrives", "long-night"],
  };
}

function mergedFinale(): PalStoryChapterDefinition & { sourceChapterIds: readonly string[] } {
  return {
    ...requireChapter("lumi-returns"),
    id: "snacks-and-lumi",
    revealHeadline: "Hello, Lumi",
    storyCopy: "Pip left half the moon snacks outside. That evening, Lumi returned—and stayed.",
    sourceChapterIds: ["share-the-snacks", "lumi-returns"],
  };
}

function planned(
  chapters: readonly (PalStoryChapterDefinition & { sourceChapterIds?: readonly string[] })[],
): readonly PalPlannedStoryChapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    roadmapWeek: index + 1,
    sourceChapterIds: chapter.sourceChapterIds ?? [chapter.id],
  }));
}

/**
 * Creates a stable story plan for a term. Persist the resulting chapter IDs
 * with the learner and term; do not regenerate an earned plan after scheduling
 * changes.
 */
export function createPalStoryPlan(totalPeriods: number): PalStoryPlan {
  if (!Number.isInteger(totalPeriods)) {
    throw new Error("Pip story periods must be an integer");
  }
  if (totalPeriods < MIN_STORY_PERIODS || totalPeriods > MAX_STORY_PERIODS) {
    throw new Error(`Pip's First Recipe supports ${MIN_STORY_PERIODS}–${MAX_STORY_PERIODS} instructional periods`);
  }

  if (totalPeriods === 6) {
    return {
      storyId: PIP_STORY_ID,
      version: PIP_STORY_VERSION,
      totalPeriods,
      chapters: planned([
        mergedOpening(),
        requireChapter("pip-hatches"),
        requireChapter("recipe-chosen"),
        requireChapter("burnt-batch"),
        requireChapter("second-try"),
        mergedFinale(),
      ]),
    };
  }

  if (totalPeriods === 7) {
    return {
      storyId: PIP_STORY_ID,
      version: PIP_STORY_VERSION,
      totalPeriods,
      chapters: planned([
        mergedOpening(),
        requireChapter("pip-hatches"),
        requireChapter("recipe-chosen"),
        requireChapter("burnt-batch"),
        requireChapter("second-try"),
        requireChapter("share-the-snacks"),
        requireChapter("lumi-returns"),
      ]),
    };
  }

  const selected = new Set(CORE_IDS);
  const selectedByAct: Record<PalStoryAct, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let index = 0; index < totalPeriods - CORE_IDS.length; index += 1) {
    const act = OPTIONAL_ACT_ORDER[index];
    if (!act) throw new Error("Pip story optional schedule is incomplete");
    const chapterId = OPTIONAL_PRIORITY_BY_ACT[act][selectedByAct[act]];
    if (!chapterId) throw new Error(`Pip story Act ${act} has no optional chapter available`);
    selected.add(chapterId);
    selectedByAct[act] += 1;
  }

  const chapters = PIP_STORY_CHAPTERS.filter((chapter) => selected.has(chapter.id));
  return {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
    totalPeriods,
    chapters: planned(chapters),
  };
}
