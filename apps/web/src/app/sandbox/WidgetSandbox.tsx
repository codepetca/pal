"use client";

import {
  PalAchievements,
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
  createFixturePalClient,
  type PalFixtureAction,
  type PalFixtureController,
  type PalTheme,
  usePalWidget,
} from "@pal/widget";
import { type ReactNode, useState } from "react";

import styles from "./widget-sandbox.module.css";

type HostView = "achievements" | "classroom";

const FIXTURE_ACTIONS: Array<{
  action: PalFixtureAction;
  label: string;
  detail: string;
}> = [
  {
    action: "daily-log-completed",
    label: "Complete daily log",
    detail: "Advances Weekly Rhythm",
  },
  {
    action: "on-time-finish",
    label: "Finish on time",
    detail: "Adds an earned item badge",
  },
  {
    action: "reward-earned",
    label: "Earn fish reward",
    detail: "Shows the celebration surface",
  },
  {
    action: "duplicate-replayed",
    label: "Replay duplicate",
    detail: "Must not change progress",
  },
  {
    action: "advance-week",
    label: "Advance one week",
    detail: "Moves the fictional semester",
  },
];

function FixtureControls({
  client,
  collapsed,
  onCollapsedChange,
  onRefresh,
  onReset,
}: {
  client: PalFixtureController;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onRefresh: () => Promise<void>;
  onReset: () => void;
}) {
  const [log, setLog] = useState<string[]>([
    "Fixture preview ready — no production state is connected.",
  ]);

  async function dispatch(action: PalFixtureAction) {
    const result = client.dispatch(action);
    setLog((current) => [result, ...current].slice(0, 6));
    if (action === "reset") {
      onReset();
      return;
    }
    await onRefresh();
  }

  return (
    <aside
      className={styles.controls}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Fictional semester controls"
    >
      <button
        className={styles.controlToggle}
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <span aria-hidden="true">⚡</span>
        <span>{collapsed ? "Open sandbox controls" : "Close"}</span>
      </button>

      {!collapsed ? (
        <div className={styles.controlPanel}>
          <header>
            <div>
              <span className={styles.fixtureLabel}>Fixture preview</span>
              <h2>Semester controls</h2>
            </div>
            <p>Visual states only. Real pipeline mode comes after the v1 receiver.</p>
          </header>

          <div className={styles.controlActions}>
            {FIXTURE_ACTIONS.map(({ action, label, detail }) => (
              <button type="button" key={action} onClick={() => void dispatch(action)}>
                <strong>{label}</strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>

          <div className={styles.controlLog} aria-live="polite">
            <span>Recent results</span>
            <ul>
              {log.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ul>
          </div>

          <button
            className={styles.resetButton}
            type="button"
            onClick={() => void dispatch("reset")}
          >
            Reset fictional learner
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function SandboxExperience({
  client,
  theme,
  view,
  onViewChange,
  onThemeChange,
}: {
  client: PalFixtureController;
  theme: PalTheme;
  view: HostView;
  onViewChange: (view: HostView) => void;
  onThemeChange: (theme: PalTheme) => void;
}) {
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [resetGeneration, setResetGeneration] = useState(0);
  const fixtureScopeKey = `fixture-learner-${resetGeneration}`;

  return (
    <PalProvider
      key={fixtureScopeKey}
      client={client}
      initialSnapshot={client.peek()}
      scopeKey={fixtureScopeKey}
      theme={theme}
    >
      <div className={styles.sandbox} data-theme={theme}>
        <header className={styles.appHeader}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">P</span>
            <div>
              <strong>Pika host preview</strong>
              <span>Pal widget sandbox</span>
            </div>
          </div>
          <div className={styles.hostControls} aria-label="Host preview settings">
            <div className={styles.viewSwitch} aria-label="Preview surface">
              <button
                type="button"
                aria-pressed={view === "achievements"}
                onClick={() => onViewChange("achievements")}
              >
                Achievements
              </button>
              <button
                type="button"
                aria-pressed={view === "classroom"}
                onClick={() => onViewChange("classroom")}
              >
                Classroom
              </button>
            </div>
            <button
              className={styles.themeButton}
              type="button"
              onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
            >
              <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div className={styles.classroomShell}>
          <nav className={styles.sidebar} aria-label="Fictional Pika classroom">
            <span className={styles.classroomName}>Learning Strategies</span>
            {["Today", "Achievements", "Classwork", "Calendar", "Resources"].map((item) => (
              <button
                type="button"
                key={item}
                data-active={
                  item === "Achievements" && view === "achievements" ? "true" : "false"
                }
                onClick={
                  item === "Achievements"
                    ? () => onViewChange("achievements")
                    : () => onViewChange("classroom")
                }
              >
                <span aria-hidden="true">
                  {item === "Achievements" ? "◇" : "·"}
                </span>
                {item}
              </button>
            ))}
          </nav>

          <main className={styles.content}>
            {view === "achievements" ? (
              <PalAchievements />
            ) : (
              <section className={styles.classroomContent}>
                <p className={styles.hostEyebrow}>Friday, October 2</p>
                <h1>Today</h1>
                <p>
                  This neutral host content lets the team assess the companion without
                  hiding it behind an imitation Pal page.
                </p>
                <div className={styles.lessonCard}>
                  <span>Today&apos;s learning</span>
                  <h2>Reflect on your week</h2>
                  <p>Complete your daily log and check what is coming next.</p>
                </div>
              </section>
            )}
          </main>

          <div className={styles.companionSlot}>
            <PalCompanion />
          </div>

          <div className={styles.celebrationLayer}>
            <PalRewardCelebration />
          </div>
        </div>

        <FixtureRefreshBridge>
          {(refresh) => (
            <FixtureControls
              client={client}
              collapsed={controlsCollapsed}
              onCollapsedChange={setControlsCollapsed}
              onRefresh={refresh}
              onReset={() => setResetGeneration((current) => current + 1)}
            />
          )}
        </FixtureRefreshBridge>
      </div>
    </PalProvider>
  );
}

function FixtureRefreshBridge({
  children,
}: {
  children: (refresh: () => Promise<void>) => ReactNode;
}) {
  // Kept in a child so the sandbox consumes the same public hook an integration
  // can use for an explicit post-action refresh.
  const { refresh } = usePalWidget();
  return children(refresh);
}

export function WidgetSandbox() {
  const [client] = useState(() => createFixturePalClient());
  const [theme, setTheme] = useState<PalTheme>("light");
  const [view, setView] = useState<HostView>("achievements");

  return (
    <SandboxExperience
      client={client}
      theme={theme}
      view={view}
      onViewChange={setView}
      onThemeChange={setTheme}
    />
  );
}
