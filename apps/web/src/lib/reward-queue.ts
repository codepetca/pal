import type { PalRewardNotice } from "@codepet/pal-widget";

const MAX_PENDING_REWARDS = 100;

/**
 * Fairly merges the two independently ordered notice queues. Alternation keeps
 * either queue from consuming the entire bounded snapshot page.
 */
export function mergePendingRewardQueues(
  grantRewards: readonly PalRewardNotice[],
  achievementRewards: readonly PalRewardNotice[],
  limit = MAX_PENDING_REWARDS,
): PalRewardNotice[] {
  const merged: PalRewardNotice[] = [];
  const length = Math.max(grantRewards.length, achievementRewards.length);
  for (let index = 0; index < length && merged.length < limit; index += 1) {
    const achievement = achievementRewards[index];
    if (achievement) merged.push(achievement);
    if (merged.length >= limit) break;
    const grant = grantRewards[index];
    if (grant) merged.push(grant);
  }
  return merged;
}
