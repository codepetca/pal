"use client";

import { usePalWidget } from "./provider";
import type { PalAchievement } from "./types";

function AchievementBadge({ achievement }: { achievement: PalAchievement }) {
  return (
    <span
      className="pal-badge"
      aria-label={achievement.badge.label}
      role="img"
    >
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
    .filter((week) => week.status !== "future")
    .sort((a, b) => b.number - a.number);

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-labelledby="pal-roadmap-title"
    >
      <header className="pal-roadmap-header">
        <h2 id="pal-roadmap-title">Achievements</h2>
        <p>{snapshot.roadmap.semesterLabel}</p>
      </header>

      <ol className="pal-roadmap-list">
        {visibleWeeks.map((week) => {
          const earnedAchievements = week.achievements.filter(
            (achievement) => achievement.status === "earned",
          );

          return (
            <li
              className="pal-week"
              data-week-status={week.status}
              key={week.id}
              aria-current={week.status === "current" ? "step" : undefined}
            >
              <div className="pal-week-marker" aria-hidden="true">
                <span>{week.number}</span>
              </div>
              <article className="pal-week-content">
                <header className="pal-week-header">
                  <h3>{week.label}</h3>
                  {week.status === "current" ? (
                    <span className="pal-week-chip">This week</span>
                  ) : earnedAchievements.length > 0 ? (
                    <span className="pal-week-earned">Earned</span>
                  ) : null}
                </header>

                {week.status === "current" ? (
                  <ul className="pal-achievement-list">
                    {week.achievements.map((achievement) => (
                      <li
                        className="pal-achievement-card"
                        data-achievement-status={achievement.status}
                        key={achievement.id}
                      >
                        <AchievementBadge achievement={achievement} />
                        <div className="pal-achievement-copy">
                          <h4>{achievement.title}</h4>
                          {achievement.progress ? (
                            <div className="pal-progress-wrap">
                              <progress
                                value={achievement.progress.current}
                                max={achievement.progress.target}
                                aria-label={`${achievement.title}: ${achievement.progress.label}`}
                              />
                              <span>{achievement.progress.label}</span>
                            </div>
                          ) : (
                            <span className="pal-status">{achievement.statusLabel}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : earnedAchievements.length > 0 ? (
                  <ul className="pal-earned-badges" aria-label={`${week.label} achievements`}>
                    {earnedAchievements.map((achievement) => (
                      <li key={achievement.id}>
                        <AchievementBadge achievement={achievement} />
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
