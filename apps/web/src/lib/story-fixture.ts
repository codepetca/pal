import type { PalProgressionState, PalRewardNotice } from "@codepet/pal-widget";
import type { BehaviorTitleId } from "@/lib/reward-grants";
import type { PersistedStoryPlan } from "@/lib/story-plan";
import {
  projectStoryProgression,
  projectUnseenGrantRewards,
  type ProjectableRewardGrant,
} from "@/lib/story-projector";

/** In-memory ledger for fixtures; projection is shared verbatim with production. */
export class StoryFixtureLedger {
  readonly #plan: PersistedStoryPlan;
  readonly #grants: ProjectableRewardGrant[] = [];
  #nextOrder = 1;

  constructor(plan: PersistedStoryPlan) {
    this.#plan = plan;
  }

  grantStoryChapter(assignmentId: string, sourceFactId: string): void {
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
    return projectStoryProgression(this.#plan, this.#grants);
  }

  rewards(): PalRewardNotice[] {
    return projectUnseenGrantRewards(this.#plan, this.#grants);
  }

  grants(): readonly ProjectableRewardGrant[] {
    return this.#grants;
  }
}
