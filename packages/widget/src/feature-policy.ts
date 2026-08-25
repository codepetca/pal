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
  const titleOnly =
    reward.achievement === undefined &&
    reward.kind !== "story" &&
    reward.titleAward !== undefined;
  if (titleOnly) return undefined;
  const visible = { ...reward };
  delete visible.titleAward;
  delete visible.titleRevealCopy;
  return visible;
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
