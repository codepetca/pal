"use client";

import { type CSSProperties, useState } from "react";

import { usePalWidget } from "./provider";
import type {
  PalAchievement,
  PalAchievementStatus,
  PalRoadmapWeek,
} from "./types";

const STATUS_ICONS: Record<PalAchievementStatus, string> = {
  earned: "✓",
  "in-progress": "●",
  incomplete: "!",
  upcoming: "○",
};

function Chevron() {
  return (
    <svg
      className="pal-chevron"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Lock() {
  return (
    <svg
      className="pal-lock"
      viewBox="0 0 16 16"
      width="16"
      height="16"
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

/** A bar that can animate its fill, which `<progress>` cannot. */
function ProgressBar({ current, max, label }: {
  current: number;
  max: number;
  label: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, current / max)) : 0;
  return (
    <div className="pal-progress-wrap">
      <div
        className="pal-bar"
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuetext={label}
      >
        <span
          className="pal-bar-fill"
          style={{ "--pal-fill": ratio } as CSSProperties}
        />
      </div>
      <span>{label}</span>
    </div>
  );
}

function AchievementRow({ achievement, index }: {
  achievement: PalAchievement;
  index: number;
}) {
  return (
    <li
      className="pal-achievement-card pal-rise"
      data-achievement-status={achievement.status}
      style={{ "--pal-i": index } as CSSProperties}
    >
      <span className="pal-badge" aria-hidden="true">
        {achievement.badge.assetUrl ? (
          <img src={achievement.badge.assetUrl} alt="" width="48" height="48" />
        ) : (
          achievement.badge.icon ?? "★"
        )}
      </span>
      <div className="pal-achievement-copy">
        <div className="pal-achievement-title-row">
          <h4>{achievement.title}</h4>
          <span className="pal-status">
            <span aria-hidden="true">{STATUS_ICONS[achievement.status]}</span>
            <span className="pal-sr-only">{achievement.statusLabel}</span>
          </span>
        </div>
        {achievement.progress ? (
          <ProgressBar
            current={achievement.progress.current}
            max={achievement.progress.target}
            label={achievement.progress.label}
          />
        ) : null}
      </div>
    </li>
  );
}

function AchievementList({ week }: { week: PalRoadmapWeek }) {
  if (week.achievements.length === 0) {
    return <p className="pal-quiet-copy">Nothing here yet.</p>;
  }
  return (
    <ul className="pal-achievement-list">
      {week.achievements.map((achievement, index) => (
        <AchievementRow
          achievement={achievement}
          index={index}
          key={achievement.id}
        />
      ))}
    </ul>
  );
}

export function PalAchievements() {
  const { density, error, motion, refresh, snapshot, state, theme, viewport } =
    usePalWidget();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [openPastWeek, setOpenPastWeek] = useState<string | null>(null);

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

  const { currentWeek, weeks } = snapshot.roadmap;
  const current = weeks.find((week) => week.number === currentWeek) ?? weeks[0];
  if (!current) return null;

  const next = weeks.find((week) => week.number === current.number + 1);
  // Newest first: the week a student just left is the one they are most likely
  // to want back.
  const past = weeks
    .filter((week) => week.number < current.number)
    .sort((a, b) => b.number - a.number);

  const earned = weeks.reduce(
    (total, week) =>
      total +
      week.achievements.filter((achievement) => achievement.status === "earned")
        .length,
    0,
  );

  return (
    <section
      className="pal-surface pal-achievements"
      {...appearance}
      aria-labelledby="pal-roadmap-title"
    >
      <header className="pal-roadmap-header">
        <p className="pal-eyebrow">{snapshot.roadmap.semesterLabel}</p>
        <h2 id="pal-roadmap-title">Your achievement path</h2>
      </header>

      <div className="pal-summary pal-rise">
        <p className="pal-summary-stat">
          <span className="pal-summary-value">{earned}</span>
          <span>badges earned</span>
        </p>
        <div className="pal-summary-track">
          <ProgressBar
            current={current.number}
            max={weeks.length}
            label={`Week ${current.number} of ${weeks.length}`}
          />
        </div>
      </div>

      <article
        className="pal-week-card pal-rise"
        data-week-status={current.status}
        style={{ "--pal-i": 1 } as CSSProperties}
        aria-labelledby="pal-current-week"
        aria-current="step"
      >
        <header className="pal-week-header">
          <h3 id="pal-current-week">{current.label}</h3>
          <span className="pal-week-chip">This week</span>
        </header>
        <AchievementList week={current} />
      </article>

      {next ? (
        <article
          className="pal-week-card pal-week-next pal-rise"
          data-week-status={next.status}
          style={{ "--pal-i": 2 } as CSSProperties}
          aria-labelledby="pal-next-week"
        >
          <header className="pal-week-header">
            <h3 id="pal-next-week">
              <span className="pal-next-flag">
                <Lock />
                Next
              </span>
              {next.label}
            </h3>
            <span>{next.dateLabel}</span>
          </header>
          <p className="pal-quiet-copy">{next.summary}</p>
        </article>
      ) : null}

      <div className="pal-history pal-rise" style={{ "--pal-i": 3 } as CSSProperties}>
        <button
          className="pal-history-toggle pal-press"
          type="button"
          aria-expanded={historyOpen}
          aria-controls="pal-history-body"
          data-open={historyOpen ? "true" : "false"}
          disabled={past.length === 0}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <Chevron />
          <span>Earlier weeks</span>
          <span className="pal-count">{past.length}</span>
        </button>

        {/* Collapsed to a zero-height row rather than unmounted, so the open and
            close both animate and the content keeps its own height. */}
        <div
          className="pal-history-body"
          id="pal-history-body"
          data-open={historyOpen ? "true" : "false"}
          inert={!historyOpen || undefined}
        >
          <div className="pal-history-inner">
            {past.length === 0 ? (
              <p className="pal-quiet-copy">The semester just started.</p>
            ) : (
              <ul className="pal-history-list">
                {past.map((week, index) => {
                  const open = openPastWeek === week.id;
                  return (
                    <li
                      className="pal-history-week pal-rise"
                      key={week.id}
                      style={{ "--pal-i": index } as CSSProperties}
                    >
                      <button
                        className="pal-history-week-toggle pal-press"
                        type="button"
                        aria-expanded={open}
                        aria-controls={`pal-history-week-${week.id}`}
                        data-open={open ? "true" : "false"}
                        onClick={() =>
                          setOpenPastWeek(open ? null : week.id)
                        }
                      >
                        <Chevron />
                        <span>{week.label}</span>
                        <span className="pal-count">
                          {week.achievements.length}
                        </span>
                      </button>
                      <div
                        className="pal-history-body"
                        id={`pal-history-week-${week.id}`}
                        data-open={open ? "true" : "false"}
                        inert={!open || undefined}
                      >
                        <div className="pal-history-inner">
                          <AchievementList week={week} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
