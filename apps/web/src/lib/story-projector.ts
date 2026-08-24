import type {
  PalCollectibleUnlock,
  PalCollectibleKind,
  PalProgressionState,
  PalRewardNotice,
  PalTitleUnlock,
} from "@codepet/pal-widget";
import type { LearnerRewardGrant } from "@pal/db";
import { resolveBehaviorTitle } from "@/lib/reward-grants";
import type { PersistedStoryPlan } from "@/lib/story-plan";

export interface StoryProjectionOptions {
  /** Assignment IDs whose Weekly Rhythm was earned; all other owned chapters render as sketches. */
  colorChapterAssignmentIds?: ReadonlySet<string>;
  /** Map Story V2 category names for schema-v1 widgets. */
  legacyCollectibleKinds?: boolean;
}

function collectibleKind(
  category: PalCollectibleKind,
  options: StoryProjectionOptions,
): PalCollectibleKind {
  if (!options.legacyCollectibleKinds) return category;
  if (category === "keepsake") return "cosmetic";
  if (category === "wallpaper") return "room";
  return category;
}

function collectibleFinish(
  assignmentId: string,
  options: StoryProjectionOptions,
): "sketch" | "color" {
  return options.colorChapterAssignmentIds?.has(assignmentId) ? "color" : "sketch";
}

export type ProjectableRewardGrant = Pick<
  LearnerRewardGrant,
  | "id"
  | "learnerId"
  | "grantOrder"
  | "kind"
  | "sourceFactId"
  | "storyPlanId"
  | "storyPlanChapterId"
  | "behaviorTitleId"
  | "seenAt"
>;

type EarnedTitle = {
  id: string;
  label: string;
  description: string;
  revealCopy: string;
  kind: "story" | "behavior";
  sourceFactId: string;
  grantOrder: bigint;
};

function compareGrantOrder(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function titleForGrant(
  grant: ProjectableRewardGrant,
  plansById: ReadonlyMap<string, PersistedStoryPlan>,
): EarnedTitle | undefined {
  if (grant.kind === "behavior_title" && grant.behaviorTitleId) {
    const title = resolveBehaviorTitle(grant.behaviorTitleId);
    return title
      ? { ...title, kind: "behavior", sourceFactId: grant.sourceFactId, grantOrder: grant.grantOrder }
      : undefined;
  }
  if (grant.kind !== "story_chapter" || !grant.storyPlanId) return undefined;
  const plan = plansById.get(grant.storyPlanId);
  if (!plan || plan.learnerId !== grant.learnerId) return undefined;
  const chapter = plan.chapters.find((candidate) => candidate.assignmentId === grant.storyPlanChapterId);
  return chapter?.title
    ? { ...chapter.title, kind: "story", sourceFactId: grant.sourceFactId, grantOrder: grant.grantOrder }
    : undefined;
}

function currentTitle(titles: readonly EarnedTitle[]): EarnedTitle | undefined {
  const actions = new Map<string, { actionOrder: bigint; titles: EarnedTitle[] }>();
  for (const title of titles) {
    const action = actions.get(title.sourceFactId);
    if (action) {
      if (title.grantOrder < action.actionOrder) action.actionOrder = title.grantOrder;
      action.titles.push(title);
    } else {
      actions.set(title.sourceFactId, { actionOrder: title.grantOrder, titles: [title] });
    }
  }
  const latest = [...actions.values()].sort((left, right) =>
    compareGrantOrder(right.actionOrder, left.actionOrder)
  )[0];
  return latest?.titles.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "story" ? -1 : 1;
    return compareGrantOrder(right.grantOrder, left.grantOrder);
  })[0];
}

export function projectStoryProgression(
  plan: PersistedStoryPlan,
  grants: readonly ProjectableRewardGrant[],
  plansById: ReadonlyMap<string, PersistedStoryPlan> = new Map([[plan.id, plan]]),
  options: StoryProjectionOptions = {},
): PalProgressionState {
  const storyGrants = new Map(
    grants.flatMap((grant) =>
      grant.kind === "story_chapter" &&
      grant.storyPlanId === plan.id &&
      grant.storyPlanChapterId
        ? [[grant.storyPlanChapterId, grant] as const]
        : [],
    ),
  );
  let foundNext = false;
  const collectibles: PalCollectibleUnlock[] = plan.chapters.map((chapter) => {
    const earned = storyGrants.has(chapter.assignmentId);
    if (earned) {
      const finish = collectibleFinish(chapter.assignmentId, options);
      return {
        id: chapter.collectible.id,
        chapterId: chapter.id,
        roadmapWeek: chapter.roadmapWeek,
        status: "earned",
        statusLabel: finish === "color"
          ? `Brought to life in Week ${chapter.roadmapWeek}`
          : `Story sketch from Week ${chapter.roadmapWeek}`,
        title: chapter.collectible.title,
        description: chapter.storyCopy,
        revealHeadline: chapter.revealHeadline,
        storyCopy: chapter.storyCopy,
        ...(chapter.title
          ? { titleAward: chapter.title.label, titleRevealCopy: chapter.title.revealCopy }
          : {}),
        kind: collectibleKind(chapter.collectible.kind, options),
        finish,
        assetUrl: chapter.collectible.assetUrl,
        ...(chapter.collectible.darkAssetUrl
          ? { darkAssetUrl: chapter.collectible.darkAssetUrl }
          : {}),
      };
    }
    const status = foundNext ? "locked" : "next";
    foundNext = true;
    return {
      id: `story-slot-${chapter.roadmapWeek}`,
      roadmapWeek: chapter.roadmapWeek,
      status,
      statusLabel: status === "next" ? "Reveals when this week ends" : "Locked",
    };
  });

  const earnedTitles = grants.flatMap((grant) => {
    const title = titleForGrant(grant, plansById);
    return title ? [title] : [];
  });
  const selected = currentTitle(earnedTitles);
  const titles: PalTitleUnlock[] = [...new Map(earnedTitles.map((title) => [title.id, title])).values()]
    .sort((left, right) => compareGrantOrder(left.grantOrder, right.grantOrder))
    .map((title) => ({
      id: title.id,
      status: "earned",
      statusLabel: "Earned",
      label: title.label,
      description: title.description,
    }));

  const companionChapter = plan.chapters.find(
    (chapter) =>
      chapter.collectible.id === plan.companionCollectibleId &&
      storyGrants.has(chapter.assignmentId),
  );
  return {
    companionReveal: companionChapter
      ? { status: "earned", assetUrl: companionChapter.collectible.assetUrl }
      : { status: "locked", label: "Mystery companion" },
    ...(selected ? { currentTitle: selected.label } : {}),
    collectibles,
    titles,
  };
}

export function projectUnseenGrantRewards(
  grants: readonly ProjectableRewardGrant[],
  plansById: ReadonlyMap<string, PersistedStoryPlan> = new Map(),
  options: StoryProjectionOptions = {},
): PalRewardNotice[] {
  return grants
    .filter((grant) => grant.seenAt === null)
    .toSorted((left, right) => {
      if (left.sourceFactId === right.sourceFactId && left.kind !== right.kind) {
        return left.kind === "story_chapter" ? 1 : -1;
      }
      return compareGrantOrder(left.grantOrder, right.grantOrder);
    })
    .flatMap<PalRewardNotice>((grant) => {
      if (grant.kind === "behavior_title" && grant.behaviorTitleId) {
        const title = resolveBehaviorTitle(grant.behaviorTitleId);
        return title
          ? [{
              id: grant.id,
              title: `${title.label} earned`,
              description: title.description,
              kind: "standard" as const,
              titleAward: title.label,
              titleRevealCopy: title.revealCopy,
            }]
          : [];
      }
      if (grant.kind !== "story_chapter" || !grant.storyPlanId) return [];
      const grantPlan = plansById.get(grant.storyPlanId);
      if (!grantPlan || grantPlan.learnerId !== grant.learnerId) return [];
      const chapter = grantPlan.chapters.find(
        (candidate) => candidate.assignmentId === grant.storyPlanChapterId,
      );
      return chapter
        ? [{
            id: grant.id,
            title: chapter.revealHeadline,
            description: chapter.storyCopy,
            kind: "story" as const,
            collectibleTitle: chapter.collectible.title,
            collectibleFinish: collectibleFinish(chapter.assignmentId, options),
            rewardCategory: chapter.collectible.kind,
            assetUrl: chapter.collectible.assetUrl,
            ...(chapter.collectible.darkAssetUrl
              ? { darkAssetUrl: chapter.collectible.darkAssetUrl }
              : {}),
            ...(chapter.title
              ? { titleAward: chapter.title.label, titleRevealCopy: chapter.title.revealCopy }
              : {}),
          }]
        : [];
    });
}
