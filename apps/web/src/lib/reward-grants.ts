import {
  learnerRewardGrants,
  type Db,
} from "@pal/db";

export const BEHAVIOR_TITLES = Object.freeze({
  rhythmBuilder: Object.freeze({ id: "rhythm-builder", label: "Rhythm Builder", description: "Show up three days in a row.", revealCopy: "A steady rhythm becomes a strength you can keep." }),
  onTimePro: Object.freeze({ id: "on-time-pro", label: "On-Time Pro", description: "Earn an On-Time Finish badge.", revealCopy: "You finished when it counted." }),
  levelLeader: Object.freeze({ id: "level-leader", label: "Level Leader", description: "Reach companion Level 5.", revealCopy: "Your consistent learning helped your companion grow." }),
} as const);

export type BehaviorTitleId = (typeof BEHAVIOR_TITLES)[keyof typeof BEHAVIOR_TITLES]["id"];
const behaviorById = new Map(Object.values(BEHAVIOR_TITLES).map((title) => [title.id, title]));

export function resolveBehaviorTitle(titleId: string) {
  return behaviorById.get(titleId as BehaviorTitleId);
}

export async function grantBehaviorTitle(
  db: Db,
  input: { learnerId: string; titleId: BehaviorTitleId; sourceFactId: string },
): Promise<void> {
  await db.insert(learnerRewardGrants).values({
    learnerId: input.learnerId,
    kind: "behavior_title",
    sourceFactId: input.sourceFactId,
    behaviorTitleId: input.titleId,
  }).onConflictDoNothing();
}

export async function insertStoryChapterGrant(
  db: Db,
  input: {
    learnerId: string;
    sourceFactId: string;
    storyPlanId: string;
    storyPlanChapterId: string;
  },
): Promise<boolean> {
  const [created] = await db
    .insert(learnerRewardGrants)
    .values({
      learnerId: input.learnerId,
      kind: "story_chapter",
      sourceFactId: input.sourceFactId,
      storyPlanId: input.storyPlanId,
      storyPlanChapterId: input.storyPlanChapterId,
    })
    .onConflictDoNothing()
    .returning({ id: learnerRewardGrants.id });
  return Boolean(created);
}
