import type { PalCollectibleKind } from "@codepet/pal-widget";

export const MIN_STORY_PERIODS = 6;
export const MAX_STORY_PERIODS = 24;
export const PIP_STORY_ID = "pips-first-recipe";
export const PIP_STORY_VERSION = 1;
export const HOME_STORY_ID = "a-place-to-call-home";
export const HOME_STORY_VERSION = 1;
export const HOME_STORY_PERIODS = 16;

export interface StoryReference {
  storyId: string;
  version: number;
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
    darkAssetUrl?: string;
    previewAssetUrl?: string;
    darkPreviewAssetUrl?: string;
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
  darkAssetUrl?: string,
];

const CHAPTER_ROWS: readonly ChapterRow[] = [
  ["egg-arrives", 1, "core", "Something Found You", "A heavy storm passed over the town during the night. When the rain finally slowed, a small golden egg rolled from the darkness and stopped at your door. The shell felt cold, but something inside tapped gently when you picked it up. Later that night, the egg quietly moved closer to your bed.", "mystery-egg-v1", "Mystery Egg", "/assets/world/reward-mystery-egg-v1.png", "companion"],
  ["soft-nest", 1, "optional", "A Softer Place", "You made a warm nest using the softest blanket you could find. As soon as the egg touched it, the shell began to glow and a pair of pointed ears appeared in its shadow. The egg settled into the blanket and made a quiet, peaceful sound. Outside, another cold wind was beginning to rise.", "cloud-blanket-v1", "Cloud Blanket", "/assets/world/reward-cloud-blanket-v1.png"],
  ["tiny-sound", 1, "optional", "Did you hear that?", "Something tapped from inside. You hung a little star above the nest and listened.", "star-mobile-v1", "Star Mobile", "/assets/world/reward-star-mobile-v1.png"],
  ["room-ready", 1, "optional", "Room for someone new", "You found a cushion for whoever might hatch. Waiting felt easier when there was a place ready.", "cat-cushion-v1", "Cozy Cushion", "/assets/world/reward-cat-cushion-v1.png"],
  ["first-sprout", 1, "optional", "Growing together", "A green shoot appeared beside the egg. You watered it, and both small things kept growing.", "star-plant-v1", "Star Sprout", "/assets/world/reward-star-plant-v1.png"],
  ["long-night", 1, "core", "Keep the Light On", "The coldest night of the storm arrived and the room became dark. You placed a small lantern beside the egg and stayed nearby to keep it warm. The lantern flickered through the night, but it never went out. Just before sunrise, a bright crack appeared across the golden shell.", "warming-lantern-v1", "Warming Lantern", "/assets/world/reward-warming-lantern-v1.png", "room", ["gentle-keeper", "Gentle Keeper", "You stayed when Pip needed warmth.", "Pip remembers who kept the light on."]],
  ["pip-hatches", 1, "core", "Hello, Pip", "The shell slowly opened and a small cat tumbled into the blanket. His name was Pip, and he looked around the room with wide, curious eyes. A soft golden light still glowed around his paws. Before long, Pip noticed a strange sound coming from somewhere beneath the broken pieces of his shell.", "pip-companion-v1", "Meet Pip", "/assets/pets/default.png", "companion"],
  ["food-videos", 2, "optional", "One More Video", "The sound came from a tiny phone hidden beneath the eggshell. Its screen was filled with cooking videos showing cakes, soups, and warm bread. One video showed small snacks shaped like moons and covered in golden sugar. Pip watched it several times and began gathering anything that might help him make them.", "tiny-phone-v1", "Tiny Phone", "/assets/world/reward-tiny-phone-v1.png"],
  ["empty-cupboard", 2, "optional", "First, a plan", "The cupboard was almost empty. Pip packed a bag and made a plan.", "grocery-tote-v1", "Grocery Tote", "/assets/world/reward-grocery-tote-v1.png"],
  ["choose-ingredients", 2, "optional", "Just what we need", "There were dozens of tempting ingredients. Pip chose only what the recipe needed.", "ingredient-jars-v1", "Ingredient Jars", "/assets/world/reward-ingredient-jars-v1.png"],
  ["chef-scarf", 2, "optional", "Dressed for courage", "Pip was nervous, so the scarf became a chef's scarf for the day.", "star-scarf-v1", "Starlight Scarf", "/assets/world/reward-star-scarf-v1.png", "cosmetic"],
  ["recipe-chosen", 2, "core", "Pip Has a Plan", "Pip copied the moon snack recipe onto a small card. He carefully drew every ingredient, bowl, and cooking step so nothing would be forgotten. The cupboard did not contain everything he needed, but there was enough to begin. The recipe also showed two plates, although only one cook stood in the picture.", "recipe-card-v1", "Recipe Card", "/assets/world/reward-recipe-card-v1.png", "room", ["brave-beginner", "Brave Beginner", "You helped Pip begin before everything felt certain.", "Starting before you feel ready is its own kind of brave."]],
  ["flour-storm", 3, "optional", "Flour Everywhere", "Pip poured flour into a mixing bowl and stirred much too quickly. A white cloud filled the kitchen and covered his paws, whiskers, and tail. When the flour finally settled, Pip noticed a second set of tiny pawprints near the window. They disappeared beneath the curtain before he could follow them.", "mixing-bowl-v1", "Mixing Bowl", "/assets/world/reward-mixing-bowl-v1.png"],
  ["measure-carefully", 3, "optional", "A Better Measure", "Pip tried measuring ingredients with his paws, but every amount was different. You found a set of small measuring spoons and helped him follow the recipe more carefully. Soon, the mixture began to glow with a soft silver light. For a moment, another light appeared outside the window and seemed to glow back.", "measuring-spoons-v1", "Measuring Spoons", "/assets/world/reward-measuring-spoons-v1.png"],
  ["waiting-is-hard", 3, "optional", "Let the timer remember", "Pip checked the oven every ten seconds. The timer promised it would remember.", "kitchen-timer-v1", "Kitchen Timer", "/assets/world/reward-kitchen-timer-v1.png"],
  ["burnt-batch", 3, "core", "The First Try", "The first batch stayed in the oven too long. The moon snacks came out dark, hard, and covered in smoke. Pip sat quietly beside the ruined tray and pushed the wooden spoon away. After the kitchen had cooled, he picked up the spoon again and placed it carefully beside the recipe card.", "wooden-spoon-v1", "Wooden Spoon", "/assets/world/reward-wooden-spoon-v1.png"],
  ["keep-the-pan", 3, "optional", "Tomorrow’s Pan", "The burnt pan looked completely ruined, but you helped Pip wash away the soot. Beneath the black marks was a small golden star that neither of you had seen before. Pip dried the pan and placed it beside the ingredients for another attempt. That night, something tapped softly against the kitchen window.", "star-pan-v1", "Star Pan", "/assets/world/reward-star-pan-v1.png"],
  ["second-try", 3, "core", "Pip Did It", "Pip followed every step more carefully the second time. The new batch rose perfectly and filled the room with a warm, sweet smell. He placed the golden moon snacks on a special plate and counted them twice. There was one snack more than the recipe should have made, and a pale shadow was waiting outside.", "moon-snack-plate-v1", "Moon Snack Plate", "/assets/world/reward-moon-snack-plate-v1.png", "room", ["try-again-chef", "Try-Again Chef", "You stayed for another attempt.", "Trying again changed the ending."]],
  ["flicker-outside", 4, "optional", "A Flicker Outside", "The pale shadow returned each evening but disappeared whenever Pip moved closer. He placed a moon-shaped charm beside the window so the visitor could see it from outside. During the night, the charm rang even though the air was still. The next morning, a single silver hair was caught on its edge.", "moon-window-charm-v1", "Moon Window Charm", "/assets/world/reward-moon-window-charm-v1.png"],
  ["gentle-invitation", 4, "optional", "An Invitation", "Pip drew a small moon on a card and placed it outside with one warm snack. He left the window and gave the visitor plenty of space. By morning, the snack had not been touched, but the card had been turned over. A tiny silver pawprint had appeared on the other side.", "little-invitation-v1", "Little Invitation", "/assets/world/reward-little-invitation-v1.png"],
  ["waiting-gently", 4, "optional", "Waiting Gently", "Pip placed a picnic blanket near the window and prepared two comfortable spaces. He waited for most of the afternoon, but the visitor never appeared. The second place remained empty when the room became dark. During the night, one corner of the blanket slowly folded inward as if someone had rested there.", "picnic-blanket-v1", "Picnic Blanket", "/assets/world/reward-picnic-blanket-v1.png"],
  ["share-the-snacks", 4, "core", "Half for Someone Else", "Pip placed half of the remaining moon snacks in a small bowl outside. This time, he left no card and did not wait beside the window. By morning, one snack was gone and a trail of silver light crossed the ground. At the end of the trail, two bright eyes watched quietly from the shadows.", "sharing-bowl-v1", "Sharing Bowl", "/assets/world/reward-sharing-bowl-v1.png"],
  ["recipe-for-two", 4, "optional", "For two", "Pip wrote the recipe down neatly. At the top of the page: “For two.”", "pip-cookbook-v1", "Pip's Cookbook", "/assets/world/reward-pip-cookbook-v1.png"],
  ["lumi-returns", 4, "core", "Hello, Lumi", "The silver visitor finally stepped through the open window. Her name was Lumi, and she had followed the warming lantern during the storm but had been too frightened to come inside. Pip brought the final moon snack to the picnic blanket. Pip and Lumi shared it, and the room became a safe home for both of them.", "lumi-companion-v1", "Meet Lumi", "/assets/pets/lumi-v1.png", "companion", ["true-friend", "True Friend", "Pip found the courage to make room for someone else.", "Care has a way of making more room."]],
];

const HOME_CHAPTER_ROWS: readonly ChapterRow[] = [
  ["new-start", 1, "core", "A New Adventure", "You enter a dimly-lit, unfamiliar place with your trusty lantern. Warm light spreads, and it begins to feel full of possibility.", "home-warming-lantern-v1", "Trusty Lantern", "/assets/world/reward-home-warming-lantern-v1.png"],
  ["dusty-discovery", 1, "core", "Dusty Discovery", "A small shadow flits around the lantern and disappears behind a dusty cloth. You pull back the cloth. Something beneath it gleams in the lantern light.", "home-mystery-egg-v1", "Strange Egg", "/assets/world/reward-home-mystery-egg-v1.png"],
  ["warm-place", 1, "core", "Keeping warm", "You fold pieces of soft cloth around a pillow to make a warm bed. You place the egg in the middle and set your lantern nearby to keep it warm. Each night, you check on it before going to sleep.", "makeshift-bed-v1", "Makeshift Bed", "/assets/world/reward-makeshift-bed-v2.png"],
  ["room-for-one-more", 1, "core", "Room for One More", "Once your space is tidy, you climb into bed and drift off to sleep. In the morning, you wake to something warm and furry tucked beneath the covers. The cushion beside the lantern is empty. Pip has found a new place to sleep.", "young-pip-v1", "Pip", "/assets/pets/young-pip-v1.png", "companion"],
  ["flour-footprints", 2, "core", "Flour prints", "As you go about your cleaning, you hear a muffled thump from another room. Pip appears, dusted white from nose to tail. Retracing the steps, you find an open bag of flour standing in the pantry.", "flour-bag-v1", "Flour Bag", "/assets/world/reward-flour-bag-v1.png"],
  ["baking-is-hard", 2, "core", "Unmeasured", "Feeling hungry, you decide to bake bread for yourself and your new companion. How hard could it be? You rush, guessing at each step, and the bread comes out hard and cracked. While cleaning up, you find a measuring cup tucked in a drawer. Next time, you’ll use the proper tools.", "measuring-cup-v1", "Measuring Cup", "/assets/world/reward-measuring-cup-v1.png"],
  ["try-again", 2, "core", "Undeterred", "Frustrated but undeterred, you begin again. This time, you use the measuring cup and work carefully. Soon, the aroma of freshly baked bread fills the house, and one warm, soft bun rests on the table.", "fresh-bread-v1", "Fresh Bread", "/assets/world/reward-fresh-bread-v1.png", "keepsake", ["undeterred", "Undeterred", "You kept going after a difficult first try.", "Trying again changed what came next."]],
  ["big-eater", 2, "core", "Courtyard", "Pip loves your baking and is always ready for another piece. You are happy together, spending warm afternoons in the courtyard and watching small birds fuss about the yard as they tuck scraps into a nook above the window.", "courtyard-afternoons-v1", "Courtyard Afternoons", "/assets/world/wallpaper-courtyard-afternoons-v4.png", "wallpaper", undefined, "/assets/world/wallpaper-courtyard-afternoons-dark-v4.png"],
  ["pantry-thief", 3, "core", "Pantry Thief", "You set the lantern in the pantry while searching for something to eat. A familiar shadow circles its light, snatches some bread, and darts away. Pip chases it toward the courtyard. By the time the creature drops the bread and slips outside, a large chunk is gone. You quickly shut the door behind it.", "bitten-bread-v1", "Bitten Bread", "/assets/world/reward-bitten-bread-v1.png"],
  ["soft-place", 3, "core", "Care", "The next morning, Pip scratches at the closed door. Outside, the small winged creature lies curled beneath the step, hungry, injured, and frightened. You open the door and sit nearby. When the creature edges toward the lantern’s warmth, you make a soft place beside it and carefully wrap the injured wing with clean bandages.", "care-kit-v1", "Care Kit/Bandages", "/assets/world/reward-bandages-v1.png"],
  ["new-friend", 3, "core", "New Friend", "Over the next few days, you leave bread and water nearby and care for the injured wing. Pip keeps protective watch. One morning, Lumi opens both wings fully in the lantern light.", "home-lumi-companion-v1", "Lumi", "/assets/pets/home-lumi-v1.png", "companion", ["gentle-friend", "Gentle Friend", "You made a frightened visitor feel safe.", "Gentleness made room for a new friend."]],
  ["something-sweet", 3, "core", "Something Sweet", "Soon, Pip and Lumi are playing together throughout the house. Watching them, you decide to make some treats. You find sugar and a small cup in the pantry, using the cup as a makeshift circular cutter to make golden cookies.", "cookie-plate-v1", "Cookie Plate", "/assets/world/reward-round-cookie-v1.png"],
  ["beyond-courtyard", 4, "core", "Moving beyond", "Now fully recovered, Lumi flits beyond the courtyard and circles back until you and Pip follow. A trail through the tall grass leads to a clear stream, where sunlight moves across smooth stones. The ground between you and the water is muddy and difficult to cross.", "stream-beyond-v1", "The Stream Beyond", "/assets/world/wallpaper-stream-beyond-v16.png", "wallpaper", undefined, "/assets/world/wallpaper-stream-beyond-dark-v16.png"],
  ["path-to-stream", 4, "core", "The Path", "You decide to build a path to the stream. It is hard work. Day after day, you clear weeds and set flat stones into the mud. Lumi scouts ahead, Pip tests each stone, and little by little the path reaches the water.", "stepping-stones-v1", "Stepping Stones", "/assets/world/reward-stepping-stone-v1.png"],
  ["by-stream", 4, "core", "Job done", "The new path soon becomes familiar beneath your feet. You follow it often to picnic by the stream, carrying warm bread and cookies in your basket. Pip and Lumi enjoy every visit. You feel content and quietly proud of what the three of you built together.", "stream-picnic-v1", "Stream Picnic", "/assets/world/reward-picnic-basket-v2.png", "keepsake", ["pathmaker", "Pathmaker", "You helped build a path worth returning to.", "A patient path became part of home."]],
  ["epilogue", 4, "core", "Epilogue", "Twilight settles over the courtyard. You watch your dear friends disappear into the house and remember when this place was empty. You turn your lantern toward your home for one last look. Its light catches something pale within a small pile of twigs above the window.", "new-egg-v1", "New Egg", "/assets/world/reward-new-egg-v1.png", "keepsake", ["homekeeper", "Homekeeper", "You made an empty place feel like home.", "Care, patience, and friendship made this place a home."]],
];

function chaptersFromRows(
  rows: readonly ChapterRow[],
  defaultKind: PalCollectibleKind,
  includePreviews = false,
): readonly StoryChapterDefinition[] {
  return rows.map((row): StoryChapterDefinition => ({
    id: row[0],
    act: row[1],
    kind: row[2],
    revealHeadline: row[3],
    storyCopy: row[4],
    collectible: {
      id: row[5],
      title: row[6],
      assetUrl: row[7],
      kind: row[8] ?? defaultKind,
      ...(row[10] ? { darkAssetUrl: row[10] } : {}),
      ...(includePreviews
        ? {
            previewAssetUrl: row[7].replace(/\.png$/, "-preview.webp"),
            ...(row[10]
              ? {
                  darkPreviewAssetUrl: row[10].replace(
                    /\.png$/,
                    "-preview.webp",
                  ),
                }
              : {}),
          }
        : {}),
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
}

const chapters = chaptersFromRows(CHAPTER_ROWS, "room");
const homeChapters = chaptersFromRows(HOME_CHAPTER_ROWS, "keepsake", true);
const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
const homeChapterById = new Map(homeChapters.map((chapter) => [chapter.id, chapter]));

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
const PIP_FINALE_CHAPTER_ID = "lumi-returns";
const PIP_FINALE_COLLECTIBLE = {
  id: "lumi-companion-v1",
  title: "Meet Lumi",
  assetUrl: "/assets/pets/lumi-v1.png",
  kind: "companion",
} as const;

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
  const plannedChapters = planned(selectedChapters);
  const finale = plannedChapters[plannedChapters.length - 1];
  if (
    !finale ||
    !finale.sourceChapterIds.includes(PIP_FINALE_CHAPTER_ID) ||
    finale.collectible.id !== PIP_FINALE_COLLECTIBLE.id ||
    finale.collectible.title !== PIP_FINALE_COLLECTIBLE.title ||
    finale.collectible.assetUrl !== PIP_FINALE_COLLECTIBLE.assetUrl ||
    finale.collectible.kind !== PIP_FINALE_COLLECTIBLE.kind
  ) {
    throw new Error("Pip's First Recipe must end with the Meet Lumi companion chapter");
  }
  return {
    storyId: PIP_STORY_ID,
    version: PIP_STORY_VERSION,
    totalPeriods,
    companionCollectibleId: "pip-companion-v1",
    mysteryCollectibleId: "mystery-egg-v1",
    chapters: plannedChapters,
  };
}

function createHomePlan(totalPeriods: number): StoryPlanDefinition {
  if (!Number.isInteger(totalPeriods) || totalPeriods < HOME_STORY_PERIODS || totalPeriods > MAX_STORY_PERIODS) {
    throw new Error(`A Place to Call Home supports terms with ${HOME_STORY_PERIODS}–${MAX_STORY_PERIODS} instructional periods`);
  }
  return {
    storyId: HOME_STORY_ID,
    version: HOME_STORY_VERSION,
    totalPeriods: HOME_STORY_PERIODS,
    companionCollectibleId: "young-pip-v1",
    mysteryCollectibleId: "home-mystery-egg-v1",
    chapters: planned(homeChapters),
  };
}

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
      if (
        plan.totalPeriods > periods ||
        plan.chapters.length !== plan.totalPeriods ||
        plan.chapters.some((chapter, index) => chapter.roadmapWeek !== index + 1)
      ) {
        throw new Error(`Story catalog ${storyKey(catalog)} must return one contiguous chapter per story period without exceeding the term`);
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

const homeCatalog: StoryCatalog = {
  storyId: HOME_STORY_ID,
  version: HOME_STORY_VERSION,
  minPeriods: HOME_STORY_PERIODS,
  maxPeriods: MAX_STORY_PERIODS,
  companionCollectibleId: "young-pip-v1",
  mysteryCollectibleId: "home-mystery-egg-v1",
  chapters: homeChapters,
  resolveChapter(chapterId: string) {
    return homeChapterById.get(chapterId);
  },
  createPlan(totalPeriods: number) {
    return deepFreeze(createHomePlan(totalPeriods));
  },
};

export const STORY_REGISTRY = createStoryRegistry([pipCatalog, homeCatalog]);

export const STORY_RELEASE_SCHEDULE = deepFreeze([
  {
    eligibleFromTermStartDay: "0001-01-01",
    story: { storyId: HOME_STORY_ID, version: HOME_STORY_VERSION },
  },
] as const);

export function storyForTermStartDay(termStartDay: string): StoryReference {
  const release = [...STORY_RELEASE_SCHEDULE]
    .reverse()
    .find((candidate) => candidate.eligibleFromTermStartDay <= termStartDay);
  if (!release) throw new Error("No story release is eligible for this term start");
  return release.story;
}

/** Short terms retain the adaptive legacy story; Home is the default from 16 weeks onward. */
export function storyForTerm(termStartDay: string, totalPeriods: number): StoryReference {
  if (totalPeriods < HOME_STORY_PERIODS) {
    return { storyId: PIP_STORY_ID, version: PIP_STORY_VERSION };
  }
  return storyForTermStartDay(termStartDay);
}
