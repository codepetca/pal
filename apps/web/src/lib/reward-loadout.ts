import { and, eq } from "drizzle-orm";
import {
  learnerRewardGrants,
  learnerRewardLoadouts,
  learners,
  type Db,
  type LearnerRewardLoadout,
} from "@pal/db";
import type { PalRewardCategory } from "@codepet/pal-widget";
import type { PalRewardLoadoutState } from "@codepet/pal-widget";
import {
  loadPersistedStoryPlansByIds,
  type PersistedStoryPlan,
} from "@/lib/story-plan";

export type RewardLoadoutSlot = "companion" | "wallpaper";

export class RewardLoadoutWriteError extends Error {
  constructor(
    readonly code: "learner_not_found" | "reward_not_usable",
    message: string,
  ) {
    super(message);
    this.name = "RewardLoadoutWriteError";
  }
}

export function rewardLoadoutSlot(
  category: PalRewardCategory,
): RewardLoadoutSlot | undefined {
  return category === "companion" || category === "wallpaper"
    ? category
    : undefined;
}

export async function loadRewardLoadout(
  db: Db,
  learnerId: string,
): Promise<readonly LearnerRewardLoadout[]> {
  return db
    .select()
    .from(learnerRewardLoadouts)
    .where(eq(learnerRewardLoadouts.learnerId, learnerId));
}

export function projectRewardLoadout(
  grants: readonly (typeof learnerRewardGrants.$inferSelect)[],
  plans: ReadonlyMap<string, PersistedStoryPlan>,
  loadout: readonly LearnerRewardLoadout[],
): PalRewardLoadoutState {
  const options: PalRewardLoadoutState = {
    companion: { options: [] },
    wallpaper: { options: [] },
  };
  for (const grant of grants) {
    if (grant.kind !== "story_chapter" || !grant.storyPlanId || !grant.storyPlanChapterId) continue;
    const chapter = plans
      .get(grant.storyPlanId)
      ?.chapters.find((candidate) => candidate.assignmentId === grant.storyPlanChapterId);
    if (!chapter) continue;
    const slot = rewardLoadoutSlot(chapter.collectible.kind);
    if (!slot) continue;
    options[slot].options.push({
      grantId: grant.id,
      rewardId: chapter.collectible.id,
      category: slot,
      title: chapter.collectible.title,
      assetUrl: chapter.collectible.assetUrl,
      ...(chapter.collectible.darkAssetUrl
        ? { darkAssetUrl: chapter.collectible.darkAssetUrl }
        : {}),
    });
  }
  for (const equipped of loadout) {
    const slot = equipped.slot as RewardLoadoutSlot;
    if (
      (slot === "companion" || slot === "wallpaper") &&
      options[slot].options.some((option) => option.grantId === equipped.rewardGrantId)
    ) {
      options[slot].equippedGrantId = equipped.rewardGrantId;
    }
  }
  // Preserve the deployed first-companion reveal for learners created before
  // loadouts existed. Later companions remain saved, not auto-equipped.
  if (!options.companion.equippedGrantId && options.companion.options[0]) {
    options.companion.equippedGrantId = options.companion.options[0].grantId;
  }
  return options;
}

/**
 * Equips one already-owned story reward in its supported slot. The durable
 * grant remains the ownership source; reveal-only keepsakes are rejected.
 */
async function equipStoryReward(
  db: Db,
  input: {
    learnerId: string;
    rewardGrantId: string;
    expectedSlot?: RewardLoadoutSlot;
  },
): Promise<LearnerRewardLoadout> {
  const [grant] = await db
    .select()
    .from(learnerRewardGrants)
    .where(
      and(
        eq(learnerRewardGrants.id, input.rewardGrantId),
        eq(learnerRewardGrants.learnerId, input.learnerId),
        eq(learnerRewardGrants.kind, "story_chapter"),
      ),
    )
    .limit(1);
  if (!grant?.storyPlanId || !grant.storyPlanChapterId) {
    throw new Error("Owned story reward not found");
  }

  const plans = await loadPersistedStoryPlansByIds(
    db,
    input.learnerId,
    [grant.storyPlanId],
  );
  const chapter = plans
    .get(grant.storyPlanId)
    ?.chapters.find(
      (candidate) => candidate.assignmentId === grant.storyPlanChapterId,
    );
  if (!chapter) throw new Error("Owned story reward has no catalog definition");

  const slot = rewardLoadoutSlot(chapter.collectible.kind);
  if (!slot) throw new Error("This story reward is reveal-only");
  if (input.expectedSlot && input.expectedSlot !== slot) {
    throw new Error("Story reward does not belong to the requested slot");
  }

  const [loadout] = await db
    .insert(learnerRewardLoadouts)
    .values({
      learnerId: input.learnerId,
      slot,
      rewardGrantId: grant.id,
    })
    .onConflictDoUpdate({
      target: [learnerRewardLoadouts.learnerId, learnerRewardLoadouts.slot],
      set: { rewardGrantId: grant.id, updatedAt: new Date() },
    })
    .returning();
  if (!loadout) throw new Error("Failed to equip story reward");
  return loadout;
}

async function clearRewardLoadoutSlot(
  db: Db,
  input: { learnerId: string; slot: RewardLoadoutSlot },
): Promise<void> {
  await db
    .delete(learnerRewardLoadouts)
    .where(
      and(
        eq(learnerRewardLoadouts.learnerId, input.learnerId),
        eq(learnerRewardLoadouts.slot, input.slot),
      ),
  );
}

/**
 * Applies one loadout mutation under the learner row lock used by every other
 * learner-state write. Scope validation and ownership validation happen inside
 * the same transaction, so concurrent clicks serialize and cannot cross an
 * integration or learner boundary.
 */
export async function setStoryRewardLoadout(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    slot: RewardLoadoutSlot;
    rewardGrantId: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [scopedLearner] = await tx
      .select({ id: learners.id })
      .from(learners)
      .where(and(
        eq(learners.id, input.learnerId),
        eq(learners.integrationId, input.integrationId),
      ))
      .for("update")
      .limit(1);
    if (!scopedLearner) {
      throw new RewardLoadoutWriteError(
        "learner_not_found",
        "Learner not found for this integration",
      );
    }

    if (input.rewardGrantId === null) {
      await clearRewardLoadoutSlot(tx, input);
      return;
    }

    try {
      await equipStoryReward(tx, {
        learnerId: input.learnerId,
        rewardGrantId: input.rewardGrantId,
        expectedSlot: input.slot,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /not found|no catalog|reveal-only|requested slot/i.test(error.message)
      ) {
        throw new RewardLoadoutWriteError("reward_not_usable", error.message);
      }
      throw error;
    }
  });
}
