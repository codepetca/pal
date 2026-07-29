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
  type PalViewport,
  usePalWidget,
} from "@pal/widget";
import {
  ArrowsOut,
  BookOpen,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ClipboardText,
  FileText,
  Lightning,
  Megaphone,
  Moon,
  NotePencil,
  Sun,
  Trophy,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";

import styles from "./widget-sandbox.module.css";

type HostView =
  | "today"
  | "achievements"
  | "classwork"
  | "tests"
  | "calendar"
  | "syllabus"
  | "announcements";

const NAV_ITEMS = [
  { label: "Today", view: "today", icon: NotePencil },
  { label: "Classwork", view: "classwork", icon: ClipboardText },
  { label: "Tests", view: "tests", icon: FileText },
  { label: "Calendar", view: "calendar", icon: CalendarBlank },
  { label: "Syllabus", view: "syllabus", icon: BookOpen },
  { label: "Achievements", view: "achievements", icon: Trophy },
  { label: "Announcements", view: "announcements", icon: Megaphone },
] satisfies Array<{
  label: string;
  view: HostView;
  icon: typeof NotePencil;
}>;

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
        {collapsed ? (
          <Lightning aria-hidden="true" size={17} weight="fill" />
        ) : (
          <X aria-hidden="true" size={16} weight="bold" />
        )}
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
  viewport,
  view,
  onViewChange,
  onThemeChange,
}: {
  client: PalFixtureController;
  theme: PalTheme;
  viewport: PalViewport;
  view: HostView;
  onViewChange: (view: HostView) => void;
  onThemeChange: (theme: PalTheme) => void;
}) {
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resetGeneration, setResetGeneration] = useState(0);
  const fixtureScopeKey = `fixture-learner-${resetGeneration}`;
  const activeLabel =
    NAV_ITEMS.find((item) => item.view === view)?.label ?? "Today";

  return (
    <PalProvider
      key={fixtureScopeKey}
      client={client}
      initialSnapshot={client.peek()}
      scopeKey={fixtureScopeKey}
      density="comfortable"
      motion="system"
      theme={theme}
      viewport={viewport}
    >
      <div className={styles.sandbox} data-theme={theme}>
        <div
          className={styles.applicationLayer}
          inert={celebrationOpen || undefined}
        >
          <header className={styles.appHeader}>
          <div className={styles.brand}>
            <Image
              src="/assets/mockups/pika-student/pika-logo.png"
              alt="Pika"
              width={32}
              height={32}
              className={styles.pikaLogo}
              priority
            />
            <strong>Test Classroom</strong>
          </div>
          <div className={styles.hostControls} aria-label="Host preview settings">
            <ArrowsOut aria-hidden="true" size={18} />
            <span className={styles.hostDate}>Sat Jul 18&nbsp; 11:56 AM</span>
            <button
              className={styles.themeButton}
              type="button"
              aria-label={`Use ${theme === "light" ? "dark" : "light"} preview`}
              onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? (
                <Moon aria-hidden="true" size={18} weight="fill" />
              ) : (
                <Sun aria-hidden="true" size={18} weight="fill" />
              )}
            </button>
            <span className={styles.profileAvatar} aria-label="Fictional learner S">
              S
            </span>
          </div>
          </header>

          <div
            className={styles.classroomShell}
            data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
          >
          <nav className={styles.sidebar} aria-label="Fictional Pika classroom">
            <div className={styles.navItems}>
              {NAV_ITEMS.map(({ icon: Icon, label, view: itemView }) => (
                <button
                  type="button"
                  key={itemView}
                  data-active={itemView === view ? "true" : "false"}
                  aria-current={itemView === view ? "page" : undefined}
                  aria-label={label}
                  onClick={() => onViewChange(itemView)}
                >
                  <Icon aria-hidden="true" size={24} weight="regular" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <button
              className={styles.sidebarToggle}
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setSidebarCollapsed((current) => !current)}
            >
              {sidebarCollapsed ? (
                <CaretRight aria-hidden="true" size={23} />
              ) : (
                <CaretLeft aria-hidden="true" size={23} />
              )}
            </button>
          </nav>

          <main className={styles.content}>
            {view === "achievements" ? (
              <PalAchievements />
            ) : view === "today" ? (
              <section className={styles.todayContent}>
                <div className={styles.noClassCard}>No class today</div>
                <article className={styles.pastLogs}>
                  <h1>Past logs</h1>
                  {[
                    ["Fri Jul 17", "Submitted today with a short demo of the working feature. I am happy with the progress, but I still want to refactor one repeated block tomorrow."],
                    ["Thu Jul 16", "Tested the project in a smaller browser width and found two text wrapping problems. I fixed one and wrote a note for the other."],
                    ["Wed Jul 15", ""],
                    ["Tue Jul 14", "Today I worked on my persuasive letter about bike lanes. I’m having trouble with Student2 because we disagree on the topic."],
                    ["Mon Jul 13", "Finished the lesson on functions and parameters. I can explain the difference between passing a value and returning a value more clearly now."],
                  ].map(([date, copy]) => (
                    <div className={styles.logEntry} key={date}>
                      <strong>{date}</strong>
                      {copy ? <p>{copy}</p> : null}
                    </div>
                  ))}
                </article>
              </section>
            ) : (
              <section className={styles.classroomContent}>
                <p className={styles.hostEyebrow}>Pika host preview</p>
                <h1>{activeLabel}</h1>
                <p>
                  This fictional destination keeps the sidebar interactive while the
                  team tests how Pal fits naturally inside Pika.
                </p>
                <div className={styles.lessonCard}>
                  <span>Fixture preview</span>
                  <h2>No {activeLabel.toLowerCase()} items yet</h2>
                  <p>Choose Achievements to return to the Pal roadmap.</p>
                </div>
              </section>
            )}
          </main>

          <div className={styles.companionOverlay}>
            <PalCompanion variant="compact" />
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

        <div
          className={styles.celebrationLayer}
          data-open={celebrationOpen ? "true" : "false"}
        >
          <PalRewardCelebration
            modal
            onOpenChange={setCelebrationOpen}
          />
        </div>
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
  const [theme, setTheme] = useState<PalTheme>("dark");
  const [viewport, setViewport] = useState<PalViewport>("wide");
  const [view, setView] = useState<HostView>("achievements");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 48rem)");
    const updateViewport = () => setViewport(query.matches ? "narrow" : "wide");
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  return (
    <SandboxExperience
      client={client}
      theme={theme}
      viewport={viewport}
      view={view}
      onViewChange={setView}
      onThemeChange={setTheme}
    />
  );
}
