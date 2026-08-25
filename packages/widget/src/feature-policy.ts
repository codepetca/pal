import type {
  PalCollectibleUnlock,
  PalRewardNotice,
  PalWidgetSnapshot,
} from "./types";

/**
 * Temporary product policy. Keep title ownership in canonical state while the
 * learner-facing presentation is being redesigned.
 */
export const PAL_ACHIEVEMENT_TITLES_VISIBLE = false;

function collectibleWithoutTitle(
  collectible: PalCollectibleUnlock,
): PalCollectibleUnlock {
  if (collectible.status !== "earned") return collectible;
  const visible = { ...collectible };
  delete visible.titleAward;
  delete visible.titleRevealCopy;
  return visible;
}

function rewardWithoutTitle(reward: PalRewardNotice): PalRewardNotice | undefined {
  if (isConcealedTitleReward(reward)) return undefined;
  const visible = { ...reward };
  delete visible.titleAward;
  delete visible.titleRevealCopy;
  return visible;
}

function isConcealedTitleReward(reward: PalRewardNotice): boolean {
  return !PAL_ACHIEVEMENT_TITLES_VISIBLE &&
    reward.achievement === undefined &&
    reward.kind !== "story" &&
    reward.titleAward !== undefined;
}

export function concealedPalTitleRewardIds(
  snapshot: PalWidgetSnapshot,
): string[] {
  return snapshot.rewards
    .filter(isConcealedTitleReward)
    .map((reward) => reward.id);
}

/**
 * Defends portable widget hosts from older or independently-built snapshots
 * that still contain title presentation fields.
 */
export function applyPalFeaturePolicy(
  snapshot: PalWidgetSnapshot,
): PalWidgetSnapshot {
  if (PAL_ACHIEVEMENT_TITLES_VISIBLE) return snapshot;
  const progression = snapshot.progression
    ? {
        ...snapshot.progression,
        collectibles: snapshot.progression.collectibles.map(collectibleWithoutTitle),
        titles: [],
      }
    : undefined;
  if (progression) delete progression.currentTitle;
  return {
    ...snapshot,
    rewards: snapshot.rewards.flatMap((reward) => {
      const visible = rewardWithoutTitle(reward);
      return visible ? [visible] : [];
    }),
    ...(progression ? { progression } : {}),
  };
}
