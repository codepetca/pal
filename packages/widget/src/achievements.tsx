"use client";

import { usePalWidget } from "./provider";
import type { PalAchievement } from "./types";

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

  return (
    <span
      className="pal-badge-control"
      aria-label={tooltip}
      data-achievement-result={notEarned ? "not-earned" : achievement.status}
      role="img"
      tabIndex={0}
    >
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

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-labelledby="pal-roadmap-title"
    >
      <header className="pal-roadmap-header">
        <h2 id="pal-roadmap-title">Achievements</h2>
      </header>

      <ol className="pal-roadmap-list">
        {visibleWeeks.map((week) => {
          const isCurrent = week.number === snapshot.roadmap.currentWeek;
          const visibleAchievements = week.achievements;

          return (
            <li
              className="pal-week"
              data-week-status={isCurrent ? "current" : "past"}
              key={week.id}
              aria-current={isCurrent ? "step" : undefined}
            >
              <div className="pal-week-marker" aria-hidden="true">
                <span>{week.number}</span>
              </div>
              <article className="pal-week-content">
                <header className="pal-week-header">
                  <h3>{week.label}</h3>
                </header>

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
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
