"use client";

import { useEffect, useId, useRef } from "react";

import { usePalWidget } from "./provider";

const FIREWORK_PARTICLES = Array.from({ length: 24 }, (_, index) => index);

export function PalRewardCelebration({
  effect = "none",
  modal = false,
  hostManaged = false,
  showDismissAction = true,
  onOpenChange,
}: {
  effect?: "none" | "fireworks";
  modal?: boolean;
  /**
   * Leaves dialog semantics, focus containment, Escape, and focus restoration
   * to the host application's approved modal owner.
   */
  hostManaged?: boolean;
  /**
   * Hides the normal acknowledgement button when the host modal provides its
   * own dismissal affordance. Only applies with `hostManaged`; a failed
   * acknowledgement still renders Retry.
   */
  showDismissAction?: boolean;
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
  const open = Boolean(rewardId);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const focusCycleRef = useRef(0);
  const titleId = useId();

  useEffect(() => {
    if (!open || hostManaged) return;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [hostManaged, onOpenChange, open]);

  useEffect(() => {
    if (
      hostManaged ||
      !open ||
      typeof document === "undefined" ||
      typeof HTMLElement === "undefined"
    ) {
      return;
    }
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusCycle = ++focusCycleRef.current;
    dialogRef.current?.focus();
    return () => {
      const restoreFocus = () => {
        if (focusCycleRef.current !== focusCycle) return;
        if (previousFocus?.isConnected) previousFocus.focus();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
      } else {
        queueMicrotask(restoreFocus);
      }
    };
  }, [hostManaged, open]);

  if (!reward) return null;
  const pending = isRewardPending(reward.id);
  const achievement = reward.achievement;
  const grantReward = achievement ? undefined : reward;
  const storyReward = grantReward?.kind === "story";
  const titleReward = Boolean(grantReward?.titleAward);
  const rewardKind = titleReward
    ? "title"
    : achievement
      ? "achievement"
      : storyReward
        ? "story"
        : "reward";
  const title = titleReward
    ? grantReward?.titleAward
    : achievement?.title ?? grantReward?.collectibleTitle ?? grantReward?.title ?? "";
  const assetUrl = achievement?.badge.assetUrl ?? grantReward?.assetUrl;
  const icon = achievement?.badge.icon ?? grantReward?.icon;
  const showArtwork = !titleReward;

  const celebration = (
    <section
      aria-busy={pending || undefined}
      aria-labelledby={hostManaged ? undefined : titleId}
      aria-modal={!hostManaged && modal ? "true" : undefined}
      className="pal-celebration"
      data-pal-density={density}
      data-pal-effect={showArtwork ? effect : "none"}
      data-pal-motion={motion}
      data-pal-reward-kind={rewardKind}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      onKeyDown={(event) => {
        if (hostManaged) return;
        if (event.key === "Tab" && modal) {
          event.preventDefault();
          if (rewardError) {
            actionButtonRef.current?.focus();
          } else {
            dialogRef.current?.focus();
          }
        } else if (event.key === "Escape" && !pending) {
          event.preventDefault();
          void dismissReward(reward.id);
        }
      }}
      ref={dialogRef}
      role={hostManaged ? undefined : "dialog"}
      tabIndex={hostManaged ? undefined : -1}
    >
      {showArtwork ? (
        <div className="pal-celebration-stage">
          {effect === "fireworks" ? (
            <div
              aria-hidden="true"
              className="pal-celebration-fireworks"
              key={reward.id}
            >
              {FIREWORK_PARTICLES.map((particle) => (
                <span key={particle} />
              ))}
            </div>
          ) : null}
          <div className="pal-celebration-icon" aria-hidden="true">
            {assetUrl ? (
              <img
                data-collectible-finish={grantReward?.collectibleFinish ?? "color"}
                src={assetUrl}
                alt=""
                width="112"
                height="112"
              />
            ) : (
              icon ?? "★"
            )}
          </div>
        </div>
      ) : null}
      <h2 id={titleId}>{title}</h2>
      {rewardKind === "story" && grantReward?.description ? (
        <div className="pal-celebration-story">
          {grantReward.title ? (
            <p className="pal-celebration-story-headline">{grantReward.title}</p>
          ) : null}
          <p className="pal-celebration-story-copy">{grantReward.description}</p>
        </div>
      ) : null}
      {rewardError ? (
        <p className="pal-celebration-error" role="alert">
          We could not save that yet. Try again.
        </p>
      ) : null}
      {rewardError ||
      (!hostManaged && !modal) ||
      (hostManaged && showDismissAction) ? (
        <button
          className="pal-button"
          type="button"
          disabled={pending}
          onClick={() => void dismissReward(reward.id)}
          ref={actionButtonRef}
        >
          {pending ? "Saving…" : rewardError ? "Try again" : "Continue"}
        </button>
      ) : null}
    </section>
  );

  if (!modal || hostManaged) return celebration;

  return (
    <div
      className="pal-celebration-backdrop"
      data-pal-pending={pending ? "true" : "false"}
      onClick={(event) => {
        if (event.target !== event.currentTarget || pending) return;
        void dismissReward(reward.id);
      }}
    >
      {celebration}
    </div>
  );
}
