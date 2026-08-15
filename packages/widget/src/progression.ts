import type {
  PalAchievement,
  PalCollectibleUnlock,
  PalProgress,
  PalProgressionState,
  PalTitleUnlock,
} from "./types";
import { createPalStoryPlan, type PalStoryPlan } from "./story";

type ProgressionInput = {
  currentWeek: number;
  totalWeeks: number;
  level: number;
  streak: number;
  achievements: readonly PalAchievement[];
  /** Latest durably awarded title. Used when award chronology is available. */
  currentTitleId?: string;
  /** Periods whose weekly eligibility goal was durably earned. */
  earnedWeeks?: readonly number[];
  /** Persisted term plan. When absent, a deterministic plan is derived. */
  storyPlan?: PalStoryPlan;
};

type Milestone =
  | { type: "week"; target: number }
  | { type: "level"; target: number }
  | { type: "streak"; target: number }
  | { type: "achievement"; title: string; label: string };

type TitleDefinition = {
  id: string;
  label: string;
  description: string;
  milestone: Milestone;
};

const TITLES: readonly TitleDefinition[] = [
  {
    id: "rhythm-builder",
    label: "Rhythm Builder",
    description: "Show up three days in a row.",
    milestone: { type: "streak", target: 3 },
  },
  {
    id: "on-time-pro",
    label: "On-Time Pro",
    description: "Earn an On-Time Finish badge.",
    milestone: {
      type: "achievement",
      title: "On-Time Finish",
      label: "Earn On-Time Finish",
    },
  },
  {
    id: "level-leader",
    label: "Level Leader",
    description: "Reach companion Level 5.",
    milestone: { type: "level", target: 5 },
  },
];

function milestoneProgress(
  milestone: Milestone,
  input: ProgressionInput,
): { earned: boolean; label: string; progress?: PalProgress } {
  if (milestone.type === "achievement") {
    const earned = input.achievements.some(
      (achievement) =>
        achievement.status === "earned" &&
        achievement.title === milestone.title,
    );
    return { earned, label: earned ? "Earned" : milestone.label };
  }

  const current =
    milestone.type === "week"
      ? Math.min(input.currentWeek, input.totalWeeks)
      : milestone.type === "level"
        ? input.level
        : input.streak;
  const target = milestone.target;
  const lockedLabel =
    milestone.type === "week"
      ? `Week ${target}`
      : milestone.type === "level"
        ? `Level ${target}`
        : `${target}-day streak`;
  return {
    earned: current >= target,
    label: current >= target ? "Earned" : lockedLabel,
    progress: {
      current: Math.min(current, target),
      target,
      label:
        current >= target
          ? "Earned"
          : milestone.type === "week"
            ? `${current} of ${target} weeks`
            : milestone.type === "streak"
              ? `${current} of ${target} days`
              : `${current} of ${target}`,
    },
  };
}

/**
 * Builds a deterministic, read-only projection of durable learner state.
 * Unlocks do not mutate XP, streaks, world state, or achievements here.
 */
export function createPalProgressionState(
  input: ProgressionInput,
): PalProgressionState {
  const storyPlan = input.storyPlan ?? createPalStoryPlan(input.totalWeeks);
  if (storyPlan.totalPeriods !== input.totalWeeks) {
    throw new Error("Persisted story plan must match the roadmap period count");
  }

  const earnedWeeks = new Set(
    input.earnedWeeks ??
      Array.from(
        { length: Math.min(input.currentWeek, input.totalWeeks) },
        (_, index) => index + 1,
      ),
  );
  let nextCollectibleAssigned = false;
  const collectibles: PalCollectibleUnlock[] = storyPlan.chapters.map((chapter) => {
    const earned = earnedWeeks.has(chapter.roadmapWeek);
    const status = earned
      ? "earned"
      : nextCollectibleAssigned
        ? "locked"
        : "next";
    if (!earned && !nextCollectibleAssigned) nextCollectibleAssigned = true;
    return {
      id: chapter.collectible.id,
      chapterId: chapter.id,
      title: chapter.collectible.title,
      description: chapter.storyCopy,
      revealHeadline: chapter.revealHeadline,
      storyCopy: chapter.storyCopy,
      ...(chapter.title
        ? {
            titleAward: chapter.title.label,
            titleRevealCopy: chapter.title.revealCopy,
          }
        : {}),
      roadmapWeek: chapter.roadmapWeek,
      kind: chapter.collectible.kind,
      status,
      statusLabel: earned ? "Earned" : "Locked",
      assetUrl: chapter.collectible.assetUrl,
    };
  });

  const pipChapter = storyPlan.chapters.find(
    (chapter) => chapter.collectible.id === "pip-companion-v1",
  );
  if (!pipChapter) throw new Error("Pip story plan must contain Pip's reveal");
  const companionUnlocked = earnedWeeks.has(pipChapter.roadmapWeek);

  let nextTitleAssigned = false;
  let fallbackCurrentTitle: string | undefined;
  const behaviorTitles: PalTitleUnlock[] = TITLES.map((definition) => {
    const milestone = milestoneProgress(definition.milestone, input);
    if (milestone.earned) fallbackCurrentTitle = definition.label;
    const status = milestone.earned
      ? "earned"
      : nextTitleAssigned
        ? "locked"
        : "next";
    if (!milestone.earned && !nextTitleAssigned) nextTitleAssigned = true;
    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      status,
      statusLabel: milestone.label,
    };
  });

  const storyTitles: PalTitleUnlock[] = storyPlan.chapters.flatMap((chapter) => {
    if (!chapter.title) return [];
    const earned = earnedWeeks.has(chapter.roadmapWeek);
    // When award chronology is unavailable, the latest earned story chapter is
    // the safest deterministic fallback and stays displayed in later weeks.
    if (earned) {
      fallbackCurrentTitle = chapter.title.label;
    }
    return [{
      id: chapter.title.id,
      label: chapter.title.label,
      description: chapter.title.description,
      status: earned ? "earned" as const : "locked" as const,
      statusLabel: earned ? "Earned" : "Locked",
    }];
  });

  const titles = [...behaviorTitles, ...storyTitles];
  const currentTitle = input.currentTitleId
    ? titles.find(
        (title) => title.id === input.currentTitleId && title.status === "earned",
      )?.label ?? fallbackCurrentTitle
    : fallbackCurrentTitle;

  return {
    storyId: storyPlan.storyId,
    storyVersion: storyPlan.version,
    storyTotalPeriods: storyPlan.totalPeriods,
    companionUnlocked,
    companionUnlockWeek: pipChapter.roadmapWeek,
    ...(currentTitle ? { currentTitle } : {}),
    collectibles,
    titles,
  };
}
