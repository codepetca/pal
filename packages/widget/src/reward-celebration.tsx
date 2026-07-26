"use client";

import { usePalWidget } from "./provider";

export function PalRewardCelebration() {
  const {
    dismissReward,
    density,
    isRewardPending,
    motion,
    rewardError,
    snapshot,
    theme,
    viewport,
  } = usePalWidget();
  const reward = snapshot?.rewards[0];
  if (!reward) return null;
  const pending = isRewardPending(reward.id);

  return (
    <section
      className="pal-celebration"
      data-pal-density={density}
      data-pal-motion={motion}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      role="status"
    >
      <div className="pal-celebration-burst" aria-hidden="true">
        <span>✦</span><span>✧</span><span>✦</span>
      </div>
      <div className="pal-celebration-icon" aria-hidden="true">
        {reward.assetUrl ? (
          <img src={reward.assetUrl} alt="" width="80" height="80" />
        ) : (
          reward.icon ?? "★"
        )}
      </div>
      <p className="pal-eyebrow">Reward earned</p>
      <h2>{reward.title}</h2>
      <p>{reward.description}</p>
      {rewardError ? (
        <p className="pal-celebration-error" role="alert">
          We could not save that yet. Try again.
        </p>
      ) : null}
      <button
        className="pal-button"
        type="button"
        disabled={pending}
        onClick={() => void dismissReward(reward.id)}
      >
        {pending ? "Saving…" : rewardError ? "Try again" : "Continue"}
      </button>
    </section>
  );
}
