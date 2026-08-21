"use client";

import { useId, useState } from "react";

import { usePalWidget } from "./provider";
import type {
  PalAchievement,
  PalProgressionState,
} from "./types";

/**
 * The story beat for one week, sitting in the empty left column of the week
 * grid and pointing at that week's collectible. Collapsed it shows only the
 * chapter headline, so a long trail stays scannable; expanding reveals the full
 * passage that the reward celebration showed when the week was first earned.
 */
function WeekStory({
  headline,
  storyCopy,
  weekLabel,
}: {
  headline: string;
  storyCopy: string;
  weekLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <div className="pal-week-story" data-expanded={expanded ? "true" : "false"}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="pal-week-story-bubble"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <span className="pal-week-story-headline">{headline}</span>
        <span className="pal-week-story-hint">
          {expanded ? "Hide story" : `Read ${weekLabel}'s story`}
        </span>
      </button>
      <p className="pal-week-story-copy" hidden={!expanded} id={panelId}>
        {storyCopy}
      </p>
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
  const { density, error, motion, refresh, snapshot, state, theme, viewport } =
    usePalWidget();

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
    .sort((a, b) => b.number - a.number);
  const progression: PalProgressionState | undefined = snapshot.progression;

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-label="Achievement trail"
    >
      {visibleWeeks.length === 0 ? (
        <p className="pal-roadmap-empty">Your story begins when Week 1 opens.</p>
      ) : null}

      {progression?.currentTitle ? (
        <strong className="pal-current-title">{progression.currentTitle}</strong>
      ) : null}

      <ol className="pal-roadmap-list">
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
                  storyCopy={storyCopy}
                  weekLabel={week.label}
                />
              ) : null}
              <div className="pal-week-collectible-stack">
                <header className="pal-week-header">
                  <h3>{week.label}</h3>
                </header>
                <div
                  className="pal-week-collectible"
                  data-unlock-status={earnedReward ? "earned" : "locked"}
                  data-collectible-finish={earnedReward?.finish ?? "color"}
                  aria-label={earnedReward
                    ? `${week.label} collectible: ${earnedReward.title}, ${earnedReward.finish === "sketch" ? "storybook sketch" : "full color"}`
                    : `${week.label} collectible locked`}
                  role="img"
                >
                  <span className="pal-week-collectible-art" aria-hidden="true">
                    {earnedReward ? (
                      <img
                        src={earnedReward.assetUrl}
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
                </div>
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
