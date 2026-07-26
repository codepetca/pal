"use client";

import { usePalWidget } from "./provider";

export function PalRewardCelebration() {
  const { dismissReward, snapshot, theme } = usePalWidget();
  const reward = snapshot?.rewards[0];
  if (!reward) return null;

  return (
    <section
      className="pal-celebration"
      data-pal-theme={theme}
      role="status"
      aria-label="New Pal reward"
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
      <button
        className="pal-button"
        type="button"
        onClick={() => void dismissReward(reward.id)}
      >
        Continue
      </button>
    </section>
  );
}
