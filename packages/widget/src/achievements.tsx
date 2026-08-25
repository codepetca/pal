"use client";

import { useEffect, useId, useRef, useState } from "react";

import { usePalWidget } from "./provider";
import {
  centerElementWithinScrollContainer,
  findNearestVerticalScrollContainer,
} from "./scroll-container";
import type {
  PalAchievement,
  PalProgressionState,
} from "./types";

/**
 * The story beat for one week, spanning the empty left column of the week grid
 * and pointing at that week's collectible. Collapsed it is a single thin line
 * carrying the chapter headline, short enough that the collectible - not the
 * story - keeps setting the row height.
 *
 * Stories start open in wide hosts because this page owns the chapter narrative.
 * Narrow hosts keep the same durable narrative in a compact, collapsed
 * disclosure above the week's collectible and achievements so visual and
 * keyboard focus order remain aligned.
 */
function WeekStory({
  headline,
  initiallyExpanded,
  storyCopy,
  weekLabel,
}: {
  headline: string;
  initiallyExpanded: boolean;
  storyCopy: string;
  weekLabel: string;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const panelId = useId();

  return (
    <div className="pal-week-story" data-expanded={expanded ? "true" : "false"}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        aria-label={`${weekLabel}: ${headline}. ${expanded ? "Hide" : "Read"} the story.`}
        className="pal-week-story-bubble"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <span className="pal-week-story-headline">{headline}</span>
        <span aria-hidden="true" className="pal-week-story-caret" />
      </button>
      <div className="pal-week-story-panel" hidden={!expanded} id={panelId}>
        <p>{storyCopy}</p>
      </div>
    </div>
  );
}

function AchievementBadge({
  achievement,
}: {
  achievement: PalAchievement;
}) {
  const notEarned = achievement.status === "incomplete";
  const detail = achievement.progress?.label ?? achievement.statusLabel;
  const tooltip = notEarned
    ? `${achievement.title} — Not completed${achievement.progress ? ` (${detail})` : ""}`
    : `${achievement.title} — ${detail}`;
  const progress = achievement.progress;
  const progressCurrent = progress
    ? Math.min(Math.max(progress.current, 0), Math.max(progress.target, 0))
    : 0;
  const progressPercent = progress && progress.target > 0
    ? (progressCurrent / progress.target) * 100
    : 0;

  return (
    <span
      className="pal-badge-control"
      aria-label={tooltip}
      data-achievement-result={notEarned ? "not-earned" : achievement.status}
      role="img"
      tabIndex={0}
      data-has-progress={progress ? "true" : undefined}
    >
      {progress ? (
        <>
          <svg
            className="pal-badge-progress-ring"
            viewBox="0 0 44 44"
            aria-hidden="true"
            focusable="false"
          >
            <circle className="pal-badge-progress-track" cx="22" cy="22" r="20" />
            <circle
              className="pal-badge-progress-value"
              cx="22"
              cy="22"
              r="20"
              pathLength="100"
              strokeDasharray={`${progressPercent} ${100 - progressPercent}`}
            />
          </svg>
          <span className="pal-badge-progress-label" aria-hidden="true">
            {progressCurrent}/{progress.target}
          </span>
        </>
      ) : null}
      <span className="pal-badge" aria-hidden="true">
        {achievement.badge.assetUrl ? (
          <img
            src={achievement.badge.assetUrl}
            alt=""
            width="80"
            height="80"
          />
        ) : (
          achievement.badge.icon ?? "★"
        )}
      </span>
      <span className="pal-badge-tooltip" aria-hidden="true">
        {tooltip}
      </span>
    </span>
  );
}

function Lock() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor" />
      <path
        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PalAchievements() {
  const {
    density,
    error,
    loadoutError,
    loadoutErrorSlot,
    loadoutPending,
    motion,
    refresh,
    scopeKey,
    setRewardLoadout,
    snapshot,
    state,
    theme,
    viewport,
  } = usePalWidget();
  const currentWeekFocalRef = useRef<HTMLDivElement>(null);
  const roadmapRef = useRef<HTMLOListElement>(null);
  const centeredScopeKeyRef = useRef<string | null>(null);
  const currentWeekNumber = snapshot?.roadmap.currentWeek;

  useEffect(() => {
    if (
      centeredScopeKeyRef.current === scopeKey ||
      currentWeekNumber === undefined ||
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const currentWeekFocal = currentWeekFocalRef.current;
      const roadmap = roadmapRef.current;
      if (!currentWeekFocal || !roadmap) return;

      centeredScopeKeyRef.current = scopeKey;
      const scrollContainer = findNearestVerticalScrollContainer(currentWeekFocal);
      if (!scrollContainer) return;
      const focalHeight = currentWeekFocal.getBoundingClientRect().height;
      roadmap.style.setProperty(
        "--pal-achievement-scroll-padding",
        `${Math.max(0, (scrollContainer.clientHeight - focalHeight) / 2)}px`,
      );
      const prefersReducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches ?? false;
      centerElementWithinScrollContainer(
        currentWeekFocal,
        scrollContainer,
        motion === "reduced" || prefersReducedMotion ? "auto" : "smooth",
      );
    });

    return () => window.cancelAnimationFrame?.(frame);
  }, [currentWeekNumber, motion, scopeKey]);

  const appearance = {
    "data-pal-density": density,
    "data-pal-motion": motion,
    "data-pal-theme": theme,
    "data-pal-viewport": viewport,
  } as const;

  if (state === "loading" && !snapshot) {
    return (
      <section className="pal-surface pal-state" {...appearance} role="status">
        <span className="pal-spinner" aria-hidden="true" />
        <h2>Loading achievements</h2>
      </section>
    );
  }

  if ((state === "error" || error) && !snapshot) {
    return (
      <section className="pal-surface pal-state" {...appearance} role="alert">
        <span className="pal-state-icon" aria-hidden="true">!</span>
        <h2>Achievements unavailable</h2>
        <button className="pal-button" type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  }

  if (!snapshot) return null;

  const visibleWeeks = snapshot.roadmap.weeks
    .filter((week) => week.number <= snapshot.roadmap.currentWeek)
    .sort((a, b) => a.number - b.number);
  const progression: PalProgressionState | undefined = snapshot.progression;
  const wallpaper = snapshot.rewardLoadout?.wallpaper;
  const equippedWallpaper = wallpaper?.options.find(
    (option) => option.grantId === wallpaper.equippedGrantId,
  );
  const equippedWallpaperUrl = theme === "dark"
    ? equippedWallpaper?.darkAssetUrl ?? equippedWallpaper?.assetUrl
    : equippedWallpaper?.assetUrl;

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-label="Achievement trail"
      data-pal-wallpaper={equippedWallpaper ? "equipped" : "default"}
      style={equippedWallpaperUrl
        ? { backgroundImage: theme === "dark"
            ? `linear-gradient(rgba(8, 18, 45, .42), rgba(8, 18, 45, .72)), url("${equippedWallpaperUrl}")`
            : `linear-gradient(rgba(255, 250, 243, .72), rgba(255, 250, 243, .9)), url("${equippedWallpaperUrl}")` }
        : undefined}
    >
      {loadoutError && loadoutErrorSlot ? (
        <p className="pal-loadout-error" role="alert">
          {loadoutErrorSlot === "wallpaper"
            ? "Could not change wallpaper."
            : "Could not change companion."}
        </p>
      ) : null}
      {visibleWeeks.length === 0 ? (
        <p className="pal-roadmap-empty">Your story begins when Week 1 opens.</p>
      ) : null}

      {progression?.currentTitle ? (
        <strong className="pal-current-title">{progression.currentTitle}</strong>
      ) : null}

      <ol className="pal-roadmap-list" ref={roadmapRef}>
        {visibleWeeks.map((week) => {
          const isCurrent = week.number === snapshot.roadmap.currentWeek;
          const visibleAchievements = week.achievements;
          const collectible = progression?.collectibles.find(
            (candidate) => candidate.roadmapWeek === week.number,
          );
          const earnedReward =
            collectible?.status === "earned" &&
            collectible.title &&
            collectible.assetUrl
              ? collectible
              : undefined;
          const usableReward = earnedReward
            ? [
                ...(snapshot.rewardLoadout?.wallpaper.options ?? []),
                ...(snapshot.rewardLoadout?.companion.options ?? []),
              ].find((option) => option.rewardId === earnedReward.id)
            : undefined;
          const equippedGrantId = usableReward
            ? snapshot.rewardLoadout?.[usableReward.category].equippedGrantId
            : undefined;
          const equipped = Boolean(
            usableReward && usableReward.grantId === equippedGrantId,
          );
          const fallbackCompanion = Boolean(
            usableReward?.category === "companion" &&
            usableReward.grantId === snapshot.rewardLoadout?.companion.fallbackGrantId,
          );
          const collectibleArtwork = (
            <>
              <span className="pal-week-collectible-art" aria-hidden="true">
                {earnedReward ? (
                  <img
                    src={theme === "dark" ? earnedReward.darkAssetUrl ?? earnedReward.assetUrl : earnedReward.assetUrl}
                    alt=""
                    width="64"
                    height="64"
                  />
                ) : (
                  <Lock />
                )}
              </span>
              {earnedReward ? (
                <strong aria-hidden="true">{earnedReward.title}</strong>
              ) : null}
              {equipped ? (
                <span className="pal-week-collectible-status" aria-hidden="true">
                  {fallbackCompanion ? "Default companion" : "Equipped"}
                </span>
              ) : null}
            </>
          );

          const storyHeadline = earnedReward?.revealHeadline;
          const storyCopy = earnedReward?.storyCopy;

          return (
            <li
              className="pal-week"
              data-week-status={isCurrent ? "current" : "past"}
              key={week.id}
              aria-current={isCurrent ? "step" : undefined}
            >
              {storyHeadline && storyCopy ? (
                <WeekStory
                  headline={storyHeadline}
                  initiallyExpanded={viewport !== "narrow"}
                  key={`${week.id}:${viewport}`}
                  storyCopy={storyCopy}
                  weekLabel={week.label}
                />
              ) : null}
              <div
                className="pal-week-collectible-stack"
                ref={isCurrent ? currentWeekFocalRef : undefined}
              >
                <header className="pal-week-header">
                  {isCurrent ? (
                    <span className="pal-week-current-label">Current week</span>
                  ) : null}
                  <h3>{week.label}</h3>
                </header>
                {collectible && earnedReward && usableReward && !(equipped && fallbackCompanion) ? (
                  <button
                    className="pal-week-collectible"
                    type="button"
                    disabled={loadoutPending}
                    data-unlock-status="earned"
                    data-collectible-finish={earnedReward.finish ?? "color"}
                    data-loadout-equipped={equipped ? "true" : "false"}
                    aria-pressed={equipped}
                    aria-label={`${equipped ? "Stop using" : "Use"} ${earnedReward.title} as ${usableReward.category === "wallpaper" ? "the achievements wallpaper" : "the active companion"}`}
                    onClick={() => void setRewardLoadout(
                      usableReward.category,
                      equipped ? null : usableReward.grantId,
                    )}
                  >
                    {collectibleArtwork}
                  </button>
                ) : collectible ? (
                  <div
                    className="pal-week-collectible"
                    data-unlock-status={earnedReward ? "earned" : "locked"}
                    data-collectible-finish={earnedReward?.finish ?? "color"}
                    aria-label={earnedReward
                      ? equipped && fallbackCompanion
                        ? `${earnedReward.title} is the default active companion`
                        : `${week.label} collectible: ${earnedReward.title}, ${earnedReward.finish === "sketch" ? "storybook sketch" : "full color"}`
                      : `${week.label} collectible locked`}
                    role="img"
                  >
                    {collectibleArtwork}
                  </div>
                ) : null}
              </div>
              <div className="pal-week-content">
                {visibleAchievements.length > 0 ? (
                  <ul className="pal-week-badges" aria-label={`${week.label} achievements`}>
                    {visibleAchievements.map((achievement) => (
                      <li key={achievement.id}>
                        <AchievementBadge
                          achievement={achievement}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
