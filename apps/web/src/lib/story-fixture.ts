import {
  createEmptyFixtureSnapshot,
  createFixturePalClient,
} from "@codepet/pal-widget/fixture";
import type {
  PalAchievement,
  PalProgressionState,
  PalRewardNotice,
  PalWidgetSnapshot,
} from "@codepet/pal-widget";
import type { FixtureStoryRequest } from "@/app/sandbox/fixture-story-contract";
import {
  STORY_REGISTRY,
  storyForTerm,
} from "@/lib/story-catalog";
import type { BehaviorTitleId } from "@/lib/reward-grants";
import { mergePendingRewardQueues } from "@/lib/reward-queue";
import {
  projectRewardLoadout,
  type ProjectableRewardLoadout,
  type RewardLoadoutSlot,
} from "@/lib/reward-loadout";
import type { PersistedStoryPlan } from "@/lib/story-plan";
import {
  projectStoryProgression,
  projectUnseenGrantRewards,
  type ProjectableRewardGrant,
} from "@/lib/story-projector";

export class InvalidFixtureStoryCommandError extends Error {
  constructor() {
    super("Fixture story command is invalid for the projected history");
    this.name = "InvalidFixtureStoryCommandError";
  }
}

/** In-memory ledger for fixtures; projection is shared verbatim with production. */
export class StoryFixtureLedger {
  readonly #plan: PersistedStoryPlan;
  readonly #grants: ProjectableRewardGrant[] = [];
  readonly #colorChapterAssignmentIds = new Set<string>();
  #nextOrder = BigInt(1);

  constructor(plan: PersistedStoryPlan) {
    this.#plan = plan;
  }

  grantStoryChapter(
    assignmentId: string,
    sourceFactId: string,
    finish: "sketch" | "color" = "sketch",
  ): void {
    if (finish === "color") this.#colorChapterAssignmentIds.add(assignmentId);
    if (
      this.#grants.some(
        (grant) =>
          grant.kind === "story_chapter" &&
          (grant.storyPlanChapterId === assignmentId || grant.sourceFactId === sourceFactId),
      )
    ) return;
    if (!this.#plan.chapters.some((chapter) => chapter.assignmentId === assignmentId)) {
      throw new Error("Fixture story grant must reference its current plan");
    }
    this.#grants.push({
      id: `fixture-grant-${this.#nextOrder}`,
      grantOrder: this.#nextOrder++,
      learnerId: this.#plan.learnerId,
      kind: "story_chapter",
      sourceFactId,
      storyPlanId: this.#plan.id,
      storyPlanChapterId: assignmentId,
      behaviorTitleId: null,
      seenAt: null,
    });
  }

  markStoryChapterColor(assignmentId: string): void {
    if (!this.#plan.chapters.some((chapter) => chapter.assignmentId === assignmentId)) {
      throw new Error("Fixture story color must reference its current plan");
    }
    this.#colorChapterAssignmentIds.add(assignmentId);
  }

  grantBehaviorTitle(titleId: BehaviorTitleId, sourceFactId: string): void {
    if (this.#grants.some((grant) => grant.behaviorTitleId === titleId)) return;
    this.#grants.push({
      id: `fixture-grant-${this.#nextOrder}`,
      grantOrder: this.#nextOrder++,
      learnerId: this.#plan.learnerId,
      kind: "behavior_title",
      sourceFactId,
      storyPlanId: null,
      storyPlanChapterId: null,
      behaviorTitleId: titleId,
      seenAt: null,
    });
  }

  markSeen(grantId: string): void {
    const grant = this.#grants.find((candidate) => candidate.id === grantId);
    if (grant && grant.seenAt === null) grant.seenAt = new Date();
  }

  progression(): PalProgressionState {
    return projectStoryProgression(this.#plan, this.#grants, undefined, {
      colorChapterAssignmentIds: this.#colorChapterAssignmentIds,
    });
  }

  rewards(): PalRewardNotice[] {
    return projectUnseenGrantRewards(
      this.#grants,
      new Map([[this.#plan.id, this.#plan]]),
      { colorChapterAssignmentIds: this.#colorChapterAssignmentIds },
    );
  }

  grants(): readonly ProjectableRewardGrant[] {
    return this.#grants;
  }
}

const FIXTURE_TERM_START_DAY = "2026-04-13";

function fixturePlan(totalPeriods: number): PersistedStoryPlan {
  const generated = STORY_REGISTRY.createPlan(
    totalPeriods,
    storyForTerm(FIXTURE_TERM_START_DAY, totalPeriods),
  );
  return {
    ...generated,
    id: `fixture-story-plan-${totalPeriods}`,
    learnerId: "fixture-learner",
    termKey: "fixture-term",
    termStartDay: FIXTURE_TERM_START_DAY,
    chapters: generated.chapters.map((chapter) => ({
      ...chapter,
      assignmentId: `fixture-story-assignment-${chapter.roadmapWeek}`,
      periodKey: `fixture-week-${chapter.roadmapWeek}`,
    })),
  };
}

function earnedWeeklyRhythmWeeks(snapshot: PalWidgetSnapshot): Set<number> {
  return new Set(
    snapshot.roadmap.weeks.flatMap((week) =>
      week.achievements.some(
        (achievement) =>
          achievement.title === "Weekly Rhythm" && achievement.status === "earned",
      )
        ? [week.number]
        : [],
    ),
  );
}

function earnedOnTimeIds(snapshot: PalWidgetSnapshot): Set<string> {
  return new Set(
    snapshot.roadmap.weeks.flatMap((week) =>
      week.achievements.flatMap((achievement: PalAchievement) =>
        achievement.title === "On-Time Finish" && achievement.status === "earned"
          ? [achievement.id]
          : [],
      ),
    ),
  );
}

function fixtureCompanionMessage(
  mood: PalWidgetSnapshot["companion"]["mood"],
  companionName?: string,
): string {
  const subject = companionName ?? "Your companion";
  switch (mood) {
    case "happy":
      return `${subject} is happy about your progress.`;
    case "excited":
      return `${subject} is excited!`;
    case "sleeping":
      return `${subject} is taking a rest.`;
    default:
      return companionName
        ? `Complete positive learning actions to encourage ${companionName}.`
        : "Complete positive learning actions to encourage your companion.";
  }
}

/** Replays bounded synthetic fixture actions through an in-memory grant ledger. */
export async function projectStoryFixture(
  request: FixtureStoryRequest,
): Promise<PalWidgetSnapshot> {
  const plan = fixturePlan(request.termWeeks);
  const ledger = new StoryFixtureLedger(plan);
  const presentation = createFixturePalClient(
    createEmptyFixtureSnapshot(request.termWeeks),
  );
  const plans = new Map([[plan.id, plan]]);
  let loadout: ProjectableRewardLoadout[] = [];

  const setLoadout = (
    slot: RewardLoadoutSlot,
    rewardGrantId: string | null,
  ): void => {
    loadout = loadout.filter((row) => row.slot !== slot);
    if (rewardGrantId === null) return;
    const option = projectRewardLoadout(ledger.grants(), plans, loadout)[slot]
      .options.find((candidate) => candidate.grantId === rewardGrantId);
    if (!option) throw new InvalidFixtureStoryCommandError();
    loadout.push({ slot, rewardGrantId, hidden: false });
  };

  for (const command of request.commands) {
    if (command.type === "acknowledge") {
      await presentation.markRewardSeen(command.rewardId);
      ledger.markSeen(command.rewardId);
      continue;
    }
    if (command.type === "set-loadout") {
      setLoadout(command.slot, command.rewardGrantId);
      continue;
    }
    if (command.type === "set-companion-visibility") {
      const selected = loadout.find((row) => row.slot === "companion");
      if (selected) {
        selected.hidden = command.hidden;
      } else if (command.hidden) {
        const fallbackGrantId = projectRewardLoadout(ledger.grants(), plans, [])
          .companion.fallbackGrantId;
        if (fallbackGrantId) {
          loadout.push({
            slot: "companion",
            rewardGrantId: fallbackGrantId,
            hidden: true,
          });
        }
      }
      continue;
    }

    const before = presentation.peek();
    const beforeWeek = before.roadmap.currentWeek;
    const beforeRhythms = earnedWeeklyRhythmWeeks(before);
    const beforeOnTime = earnedOnTimeIds(before);
    presentation.dispatch(command.action, command.context);
    const after = presentation.peek();
    const newlyEarnedWeeks = [...earnedWeeklyRhythmWeeks(after)].filter(
      (week) => !beforeRhythms.has(week),
    );
    if (newlyEarnedWeeks.length > 1) {
      throw new Error("One fixture action cannot earn multiple story chapters");
    }
    for (const week of newlyEarnedWeeks) {
      const assignment = plan.chapters.find(
        (chapter) => chapter.roadmapWeek === week,
      );
      if (!assignment) throw new Error("Fixture story plan is missing a week");
      // Weekly Rhythm changes presentation only. Ownership still waits for the
      // fixture's week-end stand-in (`advance-week`), matching persistence.
      ledger.markStoryChapterColor(assignment.assignmentId);
    }

    if (
      command.action === "advance-week" &&
      (after.roadmap.currentWeek > beforeWeek || beforeWeek === plan.totalPeriods)
    ) {
      const completedAssignment = plan.chapters.find(
        (chapter) => chapter.roadmapWeek === beforeWeek,
      );
      if (!completedAssignment) throw new Error("Fixture story plan is missing a week");
      ledger.grantStoryChapter(completedAssignment.assignmentId, command.id, "sketch");
    }

    if (
      command.action === "on-time-finish" &&
      [...earnedOnTimeIds(after)].some((id) => !beforeOnTime.has(id))
    ) {
      ledger.grantBehaviorTitle("on-time-pro", command.id);
    }
    if (before.companion.streak < 3 && after.companion.streak >= 3) {
      ledger.grantBehaviorTitle("rhythm-builder", command.id);
    }
    if (before.companion.level < 5 && after.companion.level >= 5) {
      ledger.grantBehaviorTitle("level-leader", command.id);
    }
  }

  const snapshot = await presentation.getSnapshot();
  const progression = ledger.progression();
  const rewardLoadout = projectRewardLoadout(ledger.grants(), plans, loadout);
  const equippedCompanion = rewardLoadout.companion.options.find(
    (option) => option.grantId === rewardLoadout.companion.equippedGrantId,
  );
  const displayedProgression = equippedCompanion
    ? {
        ...progression,
        companionReveal: {
          status: "earned" as const,
          assetUrl: equippedCompanion.assetUrl,
        },
      }
    : progression;
  const companionRevealed = displayedProgression.companionReveal.status === "earned";
  const companionName = equippedCompanion?.title ?? (
    companionRevealed ? "Pip" : undefined
  );
  snapshot.companion.name = companionName ?? "Mystery companion";
  snapshot.companion.message = fixtureCompanionMessage(
    snapshot.companion.mood,
    companionName,
  );
  snapshot.progression = displayedProgression;
  snapshot.rewardLoadout = rewardLoadout;
  snapshot.rewards = mergePendingRewardQueues(
    ledger.rewards(),
    snapshot.rewards,
  );
  return snapshot;
}
