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
} from "@codepet/pal-widget";
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { createSandboxPalClient } from "./sandbox-client";
import {
  addDays,
  eventForAction,
  isTodayOrEarlier,
  type SandboxEventRequest,
} from "./sandbox-events";
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
    action: "session-started",
    label: "Start session",
    detail: "platform.session.started",
  },
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
    action: "late-finish",
    label: "Finish late",
    detail: "Adds a late completion badge",
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
];

function FixtureControls({
  client,
  collapsed,
  onCollapsedChange,
  onRefresh,
  onReset,
  simulatedDate,
  onAddDay,
  onAddWeek,
  canAddDay,
  canAddWeek,
  learnerId,
  sandboxError,
}: {
  client: PalFixtureController;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onRefresh: () => Promise<void>;
  onReset: () => void;
  simulatedDate: Date;
  onAddDay: () => void;
  onAddWeek: () => void;
  canAddDay: boolean;
  canAddWeek: boolean;
  learnerId: string;
  sandboxError: string | null;
}) {
  const [log, setLog] = useState<string[]>([
    "Sandbox ready — companion state is persisted through the real pipeline.",
  ]);
  const [busy, setBusy] = useState(false);
  const lastRequest = useRef<SandboxEventRequest | null>(null);

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error ?? `request failed (${res.status})`));
    }
    return data;
  }

  async function dispatch(action: PalFixtureAction) {
    if (busy) return;
    setBusy(true);
    try {
      const fixtureResult = client.dispatch(action);

      if (action === "reset") {
        await post("/api/sandbox/reset", { learner_id: learnerId });
        lastRequest.current = null;
        setLog((current) => ["Persisted learner reset", fixtureResult, ...current].slice(0, 6));
        onReset();
        return;
      }

      const request =
        action === "duplicate-replayed"
          ? lastRequest.current
          : eventForAction(action, simulatedDate, learnerId);
      if (request) {
        const data = await post("/api/sandbox/events", request);
        if (action !== "duplicate-replayed") lastRequest.current = request;
        setLog((current) => [
          `→ ${request.event_type}: ${String(data.status)}`,
          fixtureResult,
          ...current,
        ].slice(0, 6));
      } else {
        const detail =
          action === "duplicate-replayed"
            ? "Nothing to replay — send a real event first"
            : fixtureResult;
        setLog((current) => [detail, ...current].slice(0, 6));
      }

      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      setLog((current) => [`Pipeline error: ${message}`, ...current].slice(0, 6));
    } finally {
      setBusy(false);
    }
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
            <p>
              Companion events use the v1 receiver and persisted rule-engine state;
              roadmap and reward states remain fixtures.
            </p>
          </header>

          <div className={styles.dateBar}>
            <span className={styles.dateLabel}>Simulated date</span>
            <span className={styles.dateValue}>
              {simulatedDate.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <div className={styles.dateButtons}>
              <button type="button" onClick={onAddDay} disabled={!canAddDay} aria-label="Add 1 day">
                +1 day
              </button>
              <button type="button" onClick={onAddWeek} disabled={!canAddWeek} aria-label="Add 1 week">
                +1 week
              </button>
            </div>
          </div>

          <div className={styles.controlActions}>
            {FIXTURE_ACTIONS.map(({ action, label, detail }) => (
              <button type="button" key={action} disabled={busy} onClick={() => void dispatch(action)}>
                <strong>{label}</strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>

          <div className={styles.controlLog} aria-live="polite">
            <span>Recent results</span>
            {sandboxError ? <p role="alert">Pipeline error: {sandboxError}</p> : null}
            <ul>
              {log.map((entry, index) => (
                <li key={`${entry}-${index}`}>{entry}</li>
              ))}
            </ul>
          </div>

          <button
            className={styles.resetButton}
            type="button"
            disabled={busy}
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
  learnerId,
}: {
  client: PalFixtureController;
  theme: PalTheme;
  viewport: PalViewport;
  view: HostView;
  onViewChange: (view: HostView) => void;
  onThemeChange: (theme: PalTheme) => void;
  learnerId: string;
}) {
  const [simulatedDate, setSimulatedDate] = useState(
    () => new Date("2026-07-13T08:00:00Z"),
  );
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const canAddDay = isTodayOrEarlier(addDays(simulatedDate, 1));
  const canAddWeek = isTodayOrEarlier(addDays(simulatedDate, 7));

  // Derive the current semester week from the simulated date.
  // Semester starts 2026-07-13 (week 1). Each week is 7 days.
  const currentSemesterWeek = useMemo(() => {
    const semesterStart = new Date("2026-07-13T00:00:00Z");
    const diffMs = simulatedDate.getTime() - semesterStart.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(16, Math.floor(diffDays / 7) + 1));
  }, [simulatedDate]);

  // Sync the fixture client snapshot whenever the week changes.
  useEffect(() => {
    client.setWeek?.(currentSemesterWeek);
  }, [currentSemesterWeek, client]);

  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resetGeneration, setResetGeneration] = useState(0);
  const fixtureScopeKey = `${learnerId}-${resetGeneration}-w${currentSemesterWeek}`;
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
      onError={(error) => setSandboxError(error.message)}
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
          <XpBar />
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
                simulatedDate={simulatedDate}
                onAddDay={() => setSimulatedDate((prev) => addDays(prev, 1))}
                onAddWeek={() => setSimulatedDate((prev) => addDays(prev, 7))}
                canAddDay={canAddDay}
                canAddWeek={canAddWeek}
                learnerId={learnerId}
                sandboxError={sandboxError}
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

/** Reads the live companion snapshot and renders an XP bar. */
function XpBar() {
  const { snapshot, state } = usePalWidget();
  if (state === "error" || !snapshot) return null;

  const { xp, xpToNextLevel, level } = snapshot.companion;
  if (xp === undefined || xpToNextLevel === undefined) return null;
  const pct = xpToNextLevel > 0
    ? ((xp / (xp + xpToNextLevel)) * 100).toFixed(1)
    : "100";

  return (
    <div className={styles.xpBar} role="progressbar" aria-valuenow={xp} aria-valuemin={0} aria-valuemax={xp + xpToNextLevel} aria-label={`${xp} XP toward level ${level + 1}`}>
      <div className={styles.xpBarTrack}>
        <div className={styles.xpBarFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.xpBarLabel}>
        {xp} / {xp + xpToNextLevel}
      </span>
      <span className={styles.xpBarLevel}>Lv {level}</span>
    </div>
  );
}

export function WidgetSandbox() {
  const [learnerId] = useState(() => `sandbox-${crypto.randomUUID()}`);
  const [client] = useState(() =>
    createSandboxPalClient(createFixturePalClient(), learnerId),
  );
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
      learnerId={learnerId}
    />
  );
}
