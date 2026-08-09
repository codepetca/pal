"use client";

import { useState } from "react";

import { usePalWidget } from "./provider";
import type { PalAchievement, PalAchievementStatus, PalRoadmapWeek } from "./types";

const STATUS_ICONS: Record<PalAchievementStatus, string> = {
  earned: "✓",
  "in-progress": "●",
  incomplete: "!",
  upcoming: "○",
};

const PATH_LANES = ["left", "middle", "right", "middle"] as const;

function AchievementCard({
  achievement,
}: {
  achievement: PalAchievement;
  initiallyOpen: boolean;
}) {
  return (
    <div className="pal-achievement-card">
      <div className="pal-achievement-header">
        <span className="pal-status">
          <span aria-hidden="true">
            {STATUS_ICONS[achievement.status]}
          </span>
          {achievement.statusLabel}
        </span>
        <span role="heading" aria-level={4}>
          {achievement.title}
        </span>
      </div>
      <div className="pal-achievement-copy">
        <p>{achievement.description}</p>
        {achievement.progress ? (
          <div className="pal-progress-wrap">
            <progress
              value={achievement.progress.current}
              max={achievement.progress.target}
              aria-label={`${achievement.title}: ${achievement.progress.label}`}
            />
            <span>{achievement.progress.label}</span>
          </div>
        ) : null}
        {achievement.rewardLabel ? (
          <span className="pal-reward-label">
            Reward: {achievement.rewardLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function WeekNode({
  week,
  initiallyOpen,
}: {
  week: PalRoadmapWeek;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  const rhythmProgress = week.achievements.find((a) => a.progress)?.progress;

  return (
    <div
      className="pal-week-details"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div className="pal-week-summary">
        <div className="pal-week-marker-wrap">
          <div className="pal-week-marker" aria-hidden="true">
            <span>Week</span>
            <strong>{week.number}</strong>
          </div>
          {rhythmProgress ? (
            <div
              className="pal-week-stars"
              aria-label={`${rhythmProgress.current} of ${rhythmProgress.target} eligible days`}
            >
              {Array.from({ length: rhythmProgress.target }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < rhythmProgress.current
                      ? "pal-week-star pal-week-star--filled"
                      : "pal-week-star"
                  }
                  aria-hidden="true"
                >
                  ★
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {open ? (
        <div
          className="pal-week-card"
        >
          {week.status !== "future" ? (
            week.achievements.length > 0 ? (
              <ul className="pal-achievement-list">
                {week.achievements.map((achievement) => (
                  <li
                    className="pal-achievement-stop"
                    data-achievement-status={achievement.status}
                    key={achievement.id}
                  >
                    <AchievementCard
                      achievement={achievement}
                      initiallyOpen={false}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pal-empty-week-copy">
                No achievements have been recorded for this week yet.
              </p>
            )
          ) : (
            <div className="pal-future-stop">
              <span className="pal-locked-node" aria-hidden="true">○</span>
              <p className="pal-future-copy">
                Future achievements stay hidden until this week begins.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
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
        <p>Connecting to your Pal roadmap.</p>
      </section>
    );
  }

  if ((state === "error" || error) && !snapshot) {
    return (
      <section className="pal-surface pal-state" {...appearance} role="alert">
        <span className="pal-state-icon" aria-hidden="true">!</span>
        <h2>Achievements are temporarily unavailable</h2>
        <p>Your schoolwork is safe. Try loading the roadmap again.</p>
        <button className="pal-button" type="button" onClick={() => void refresh()}>
          Try again
        </button>
      </section>
    );
  }

  if (!snapshot) return null;

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-labelledby="pal-roadmap-title"
    >
      <header className="pal-roadmap-header">
        <div>
          <p className="pal-eyebrow">{snapshot.roadmap.semesterLabel}</p>
          <h2 id="pal-roadmap-title">Your achievement path</h2>
          <p>
            Week {snapshot.roadmap.currentWeek} of {snapshot.roadmap.weeks.length}
          </p>
        </div>
        <span className="pal-week-chip">Current week</span>
      </header>

      <ol className="pal-roadmap-list" aria-label="Semester achievement path">
        {snapshot.roadmap.weeks.map((week, weekIndex) => (
          <li
            className="pal-week"
            data-path-lane={PATH_LANES[weekIndex % PATH_LANES.length]}
            data-week-status={week.status}
            key={week.id}
            aria-current={week.status === "current" ? "step" : undefined}
          >
            <WeekNode
              week={week}
              initiallyOpen={week.status === "current"}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
