import type {
  PalCollectibleUnlock,
  PalProgressionState,
  PalRewardNotice,
  PalTitleUnlock,
} from "@codepet/pal-widget";
import type { LearnerRewardGrant } from "@pal/db";
import { resolveBehaviorTitle } from "@/lib/reward-grants";
import type { PersistedStoryPlan } from "@/lib/story-plan";

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
  grantOrder: number;
};

function titleForGrant(
  grant: ProjectableRewardGrant,
  plan: PersistedStoryPlan,
): EarnedTitle | undefined {
  if (grant.kind === "behavior_title" && grant.behaviorTitleId) {
    const title = resolveBehaviorTitle(grant.behaviorTitleId);
    return title
      ? { ...title, kind: "behavior", sourceFactId: grant.sourceFactId, grantOrder: grant.grantOrder }
      : undefined;
  }
  if (grant.kind !== "story_chapter" || grant.storyPlanId !== plan.id) return undefined;
  const chapter = plan.chapters.find((candidate) => candidate.assignmentId === grant.storyPlanChapterId);
  return chapter?.title
    ? { ...chapter.title, kind: "story", sourceFactId: grant.sourceFactId, grantOrder: grant.grantOrder }
    : undefined;
}

function currentTitle(titles: readonly EarnedTitle[]): EarnedTitle | undefined {
  const actions = new Map<string, { actionOrder: number; titles: EarnedTitle[] }>();
  for (const title of titles) {
    const action = actions.get(title.sourceFactId);
    if (action) {
      action.actionOrder = Math.min(action.actionOrder, title.grantOrder);
      action.titles.push(title);
    } else {
      actions.set(title.sourceFactId, { actionOrder: title.grantOrder, titles: [title] });
    }
  }
  const latest = [...actions.values()].sort((left, right) => right.actionOrder - left.actionOrder)[0];
  return latest?.titles.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "story" ? -1 : 1;
    return right.grantOrder - left.grantOrder;
  })[0];
}

export function projectStoryProgression(
  plan: PersistedStoryPlan,
  grants: readonly ProjectableRewardGrant[],
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
      return {
        id: chapter.collectible.id,
        chapterId: chapter.id,
        roadmapWeek: chapter.roadmapWeek,
        status: "earned",
        statusLabel: `Earned in Week ${chapter.roadmapWeek}`,
        title: chapter.collectible.title,
        description: chapter.storyCopy,
        revealHeadline: chapter.revealHeadline,
        storyCopy: chapter.storyCopy,
        ...(chapter.title
          ? { titleAward: chapter.title.label, titleRevealCopy: chapter.title.revealCopy }
          : {}),
        kind: chapter.collectible.kind,
        assetUrl: chapter.collectible.assetUrl,
      };
    }
    const status = foundNext ? "locked" : "next";
    foundNext = true;
    return {
      id: `story-slot-${chapter.roadmapWeek}`,
      roadmapWeek: chapter.roadmapWeek,
      status,
      statusLabel: status === "next" ? "Next Weekly Rhythm reward" : "Locked",
    };
  });

  const earnedTitles = grants.flatMap((grant) => {
    const title = titleForGrant(grant, plan);
    return title ? [title] : [];
  });
  const selected = currentTitle(earnedTitles);
  const titles: PalTitleUnlock[] = [...new Map(earnedTitles.map((title) => [title.id, title])).values()]
    .sort((left, right) => left.grantOrder - right.grantOrder)
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
    storyId: plan.storyId,
    storyVersion: plan.version,
    storyTotalPeriods: plan.totalPeriods,
    companionReveal: companionChapter
      ? { status: "earned", assetUrl: companionChapter.collectible.assetUrl }
      : { status: "locked", label: "Mystery companion" },
    ...(selected ? { currentTitle: selected.label } : {}),
    collectibles,
    titles,
  };
}

export function projectUnseenGrantRewards(
  plan: PersistedStoryPlan,
  grants: readonly ProjectableRewardGrant[],
): PalRewardNotice[] {
  return grants
    .filter((grant) => grant.seenAt === null)
    .toSorted((left, right) => {
      if (left.sourceFactId === right.sourceFactId && left.kind !== right.kind) {
        return left.kind === "story_chapter" ? 1 : -1;
      }
      return left.grantOrder - right.grantOrder;
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
      if (grant.kind !== "story_chapter" || grant.storyPlanId !== plan.id) return [];
      const chapter = plan.chapters.find((candidate) => candidate.assignmentId === grant.storyPlanChapterId);
      return chapter
        ? [{
            id: grant.id,
            title: chapter.revealHeadline,
            description: chapter.storyCopy,
            kind: "story" as const,
            collectibleTitle: chapter.collectible.title,
            assetUrl: chapter.collectible.assetUrl,
            ...(chapter.title
              ? { titleAward: chapter.title.label, titleRevealCopy: chapter.title.revealCopy }
              : {}),
          }]
        : [];
    });
}
