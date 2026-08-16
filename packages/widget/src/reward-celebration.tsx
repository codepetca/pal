"use client";

import { useEffect, useId, useRef } from "react";

import { usePalWidget } from "./provider";

export function PalRewardCelebration({
  modal = false,
  hostManaged = false,
  onOpenChange,
}: {
  modal?: boolean;
  /**
   * Leaves dialog semantics, focus containment, Escape, and focus restoration
   * to the host application's approved modal owner.
   */
  hostManaged?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
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
  const rewardId = reward?.id;
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!rewardId || hostManaged) return;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [hostManaged, onOpenChange, rewardId]);

  useEffect(() => {
    if (
      hostManaged ||
      !rewardId ||
      typeof document === "undefined" ||
      typeof HTMLElement === "undefined"
    ) {
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    continueButtonRef.current?.focus();
    return () => {
      const restoreFocus = () => {
        if (previousFocus?.isConnected) previousFocus.focus();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
      } else {
        queueMicrotask(restoreFocus);
      }
    };
  }, [hostManaged, rewardId]);

  if (!reward) return null;
  const pending = isRewardPending(reward.id);
  const achievement = reward.kind === "achievement"
    ? reward.achievement
    : undefined;
  const grantReward = reward.kind === "achievement" ? undefined : reward;
  const storyReward = grantReward?.kind === "story";
  const title = achievement?.title ?? grantReward?.title ?? "";
  const description = achievement?.description ?? grantReward?.description ?? "";
  const assetUrl = achievement?.badge.assetUrl ?? grantReward?.assetUrl;
  const icon = achievement?.badge.icon ?? grantReward?.icon;

  return (
    <section
      aria-describedby={hostManaged ? undefined : descriptionId}
      aria-labelledby={hostManaged ? undefined : titleId}
      aria-modal={!hostManaged && modal ? "true" : undefined}
      className="pal-celebration"
      data-pal-density={density}
      data-pal-motion={motion}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      onKeyDown={(event) => {
        if (hostManaged) return;
        if (event.key === "Tab" && modal) {
          event.preventDefault();
          continueButtonRef.current?.focus();
        } else if (event.key === "Escape" && !pending) {
          event.preventDefault();
          void dismissReward(reward.id);
        }
      }}
      role={hostManaged ? undefined : "dialog"}
    >
      <div className="pal-celebration-burst" aria-hidden="true">
        <span>✦</span><span>✧</span><span>✦</span>
      </div>
      <p className="pal-eyebrow">
        {achievement
          ? "Achievement earned"
          : storyReward
            ? "Story unlocked"
            : "Reward earned"}
      </p>
      <h2 id={titleId}>{title}</h2>
      <div className="pal-celebration-icon" aria-hidden="true">
        {assetUrl ? (
          <img src={assetUrl} alt="" width="80" height="80" />
        ) : (
          icon ?? "★"
        )}
      </div>
      {grantReward?.collectibleTitle ? (
        <strong className="pal-celebration-collectible">
          {grantReward.collectibleTitle}
        </strong>
      ) : null}
      <p id={descriptionId}>{description}</p>
      {grantReward?.titleAward ? (
        <div className="pal-celebration-title">
          <span>New title</span>
          <strong>{grantReward.titleAward}</strong>
          {grantReward.titleRevealCopy ? <p>{grantReward.titleRevealCopy}</p> : null}
        </div>
      ) : null}
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
        ref={continueButtonRef}
      >
        {pending ? "Saving…" : rewardError ? "Try again" : "Continue"}
      </button>
    </section>
  );
}
