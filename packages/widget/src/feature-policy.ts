import type {
  PalCollectibleUnlock,
  PalFeaturePolicy,
  PalRewardNotice,
  PalWidgetSnapshot,
} from "./types";

/**
 * Backward-compatible policy for snapshots produced before featurePolicy was
 * added to schema v1. Title ownership stays canonical while its learner-facing
 * presentation is redesigned.
 */
export const DEFAULT_PAL_FEATURE_POLICY: PalFeaturePolicy = Object.freeze({
  achievements: Object.freeze({
    titles: false,
  }),
});

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
  if (
    reward.achievement === undefined &&
    reward.kind !== "story" &&
    reward.titleAward !== undefined
  ) {
    return undefined;
  }
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
  const policy = snapshot.featurePolicy ?? DEFAULT_PAL_FEATURE_POLICY;
  if (policy.achievements.titles) return snapshot;
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
