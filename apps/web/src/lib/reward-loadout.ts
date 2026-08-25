import { and, eq } from "drizzle-orm";
import {
  learnerRewardGrants,
  learnerRewardLoadouts,
  learners,
  type Db,
  type LearnerRewardLoadout,
} from "@pal/db";
import type { PalCollectibleKind } from "@codepet/pal-widget";
import type { PalRewardLoadoutState } from "@codepet/pal-widget";
import {
  loadPersistedStoryPlansByIds,
  type PersistedStoryPlan,
} from "@/lib/story-plan";

export type RewardLoadoutSlot = "companion" | "wallpaper";
const MAX_PROJECTED_OPTIONS_PER_SLOT = 32;

type ProjectedOption = PalRewardLoadoutState["companion"]["options"][number];
type LoadoutCandidate = ProjectedOption & { grantOrder: bigint };
type ProjectableLoadoutGrant = Pick<
  typeof learnerRewardGrants.$inferSelect,
  "id" | "grantOrder" | "kind" | "storyPlanId" | "storyPlanChapterId"
>;
export type ProjectableRewardLoadout = Pick<
  LearnerRewardLoadout,
  "slot" | "rewardGrantId" | "hidden"
>;

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
  category: PalCollectibleKind,
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
  grants: readonly ProjectableLoadoutGrant[],
  plans: ReadonlyMap<string, PersistedStoryPlan>,
  loadout: readonly ProjectableRewardLoadout[],
): PalRewardLoadoutState {
  const candidates: Record<RewardLoadoutSlot, LoadoutCandidate[]> = {
    companion: [],
    wallpaper: [],
  };
  for (const grant of grants) {
    if (grant.kind !== "story_chapter" || !grant.storyPlanId || !grant.storyPlanChapterId) continue;
    const plan = plans.get(grant.storyPlanId);
    const chapter = plan?.chapters.find(
      (candidate) => candidate.assignmentId === grant.storyPlanChapterId,
    );
    if (!chapter) continue;
    // Pip v1 classified its concealed egg as a companion for presentation.
    // It is not a selectable companion and must remain concealed until hatching.
    if (chapter.collectible.id === plan?.mysteryCollectibleId) continue;
    const slot = rewardLoadoutSlot(chapter.collectible.kind);
    if (!slot) continue;
    candidates[slot].push({
      grantId: grant.id,
      grantOrder: grant.grantOrder,
      rewardId: chapter.collectible.id,
      category: slot,
      title: chapter.collectible.title,
      assetUrl: chapter.collectible.assetUrl,
      ...(chapter.collectible.darkAssetUrl
        ? { darkAssetUrl: chapter.collectible.darkAssetUrl }
        : {}),
    });
  }
  const projectSlot = (slot: RewardLoadoutSlot): PalRewardLoadoutState[typeof slot] => {
    const ordered = candidates[slot].toSorted((left, right) =>
      left.grantOrder === right.grantOrder
        ? 0
        : left.grantOrder > right.grantOrder ? -1 : 1,
    );
    const newestByReward = ordered.filter(
      (candidate, index) =>
        ordered.findIndex((other) => other.rewardId === candidate.rewardId) === index,
    );
    const persisted = loadout.find((row) => row.slot === slot);
    const persistedCandidate = persisted
      ? candidates[slot].find((candidate) => candidate.grantId === persisted.rewardGrantId)
      : undefined;
    const firstCompanion = slot === "companion"
      ? candidates.companion.toSorted((left, right) =>
          left.grantOrder === right.grantOrder
            ? 0
            : left.grantOrder < right.grantOrder ? -1 : 1,
        )[0]
      : undefined;
    const fallbackOption = newestByReward.find(
      (candidate) => candidate.rewardId === firstCompanion?.rewardId,
    );
    const equippedRewardId = persistedCandidate?.rewardId ?? fallbackOption?.rewardId;
    const equippedOption = newestByReward.find(
      (candidate) => candidate.rewardId === equippedRewardId,
    );
    const retained: LoadoutCandidate[] = [];
    if (equippedOption) retained.push(equippedOption);
    if (fallbackOption && fallbackOption !== equippedOption) {
      retained.push(fallbackOption);
    }
    const bounded = [
      ...retained,
      ...newestByReward.filter((candidate) => !retained.includes(candidate)),
    ].slice(0, MAX_PROJECTED_OPTIONS_PER_SLOT);
    const projected = bounded.map((candidate): ProjectedOption => ({
      grantId: candidate.grantId,
      rewardId: candidate.rewardId,
      category: candidate.category,
      title: candidate.title,
      assetUrl: candidate.assetUrl,
      ...(candidate.darkAssetUrl ? { darkAssetUrl: candidate.darkAssetUrl } : {}),
    }));
    return {
      options: projected,
      ...(fallbackOption && bounded.includes(fallbackOption)
        ? { fallbackGrantId: fallbackOption.grantId }
        : {}),
      ...(equippedOption ? { equippedGrantId: equippedOption.grantId } : {}),
      ...(slot === "companion" && persisted?.hidden ? { hidden: true } : {}),
    };
  };

  return {
    companion: projectSlot("companion"),
    wallpaper: projectSlot("wallpaper"),
  };
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
    throw new RewardLoadoutWriteError(
      "reward_not_usable",
      "Owned story reward not found",
    );
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
  if (!chapter) {
    throw new RewardLoadoutWriteError(
      "reward_not_usable",
      "Owned story reward has no catalog definition",
    );
  }

  const plan = plans.get(grant.storyPlanId);
  if (chapter.collectible.id === plan?.mysteryCollectibleId) {
    throw new RewardLoadoutWriteError(
      "reward_not_usable",
      "Concealed story rewards are not loadout options",
    );
  }

  const slot = rewardLoadoutSlot(chapter.collectible.kind);
  if (!slot) {
    throw new RewardLoadoutWriteError(
      "reward_not_usable",
      "This story reward is reveal-only",
    );
  }
  if (input.expectedSlot && input.expectedSlot !== slot) {
    throw new RewardLoadoutWriteError(
      "reward_not_usable",
      "Story reward does not belong to the requested slot",
    );
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
      set: { rewardGrantId: grant.id, hidden: false, updatedAt: new Date() },
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

async function setCompanionVisibilityState(
  db: Db,
  input: { learnerId: string; hidden: boolean },
): Promise<void> {
  const [selected] = await db
    .select()
    .from(learnerRewardLoadouts)
    .where(
      and(
        eq(learnerRewardLoadouts.learnerId, input.learnerId),
        eq(learnerRewardLoadouts.slot, "companion"),
      ),
    )
    .limit(1);
  if (selected) {
    await db
      .update(learnerRewardLoadouts)
      .set({ hidden: input.hidden, updatedAt: new Date() })
      .where(eq(learnerRewardLoadouts.id, selected.id));
    return;
  }

  if (!input.hidden) return;

  const grants = await db
    .select()
    .from(learnerRewardGrants)
    .where(eq(learnerRewardGrants.learnerId, input.learnerId));
  const planIds = grants.flatMap((grant) => grant.storyPlanId ? [grant.storyPlanId] : []);
  const plans = await loadPersistedStoryPlansByIds(db, input.learnerId, planIds);
  const fallbackGrantId = projectRewardLoadout(grants, plans, [])
    .companion.fallbackGrantId;
  if (!fallbackGrantId) return;
  await db.insert(learnerRewardLoadouts).values({
    learnerId: input.learnerId,
    slot: "companion",
    rewardGrantId: fallbackGrantId,
    hidden: true,
  });
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

    await equipStoryReward(tx, {
      learnerId: input.learnerId,
      rewardGrantId: input.rewardGrantId,
      expectedSlot: input.slot,
    });
  });
}

export async function setCompanionVisibility(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    hidden: boolean;
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
    await setCompanionVisibilityState(tx, input);
  });
}
