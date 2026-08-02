"use client";

import {
  PalAchievements,
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
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

import {
  createSandboxPalClient,
  type SandboxPalClient,
} from "./sandbox-client";
import {
  addDays,
  eventForAction,
  eventsForAction,
  FICTIONAL_SEMESTER_START_ISO,
  isTodayOrEarlier,
  semesterWeekForDate,
  type SandboxAction,
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

const SANDBOX_ACTIONS: Array<{
  action: SandboxAction;
  label: string;
  detail: string;
}> = [
  {
    action: "session-started",
    label: "Start session",
    detail: "platform.session.started",
  },
  {
    action: "classroom-joined",
    label: "Join classroom",
    detail: "classroom.joined",
  },
  {
    action: "week-configured",
    label: "Configure this week",
    detail: "Creates a 5-day Weekly Rhythm target",
  },
  {
    action: "short-week-configured",
    label: "Make it a short week",
    detail: "Revises Weekly Rhythm to 3 eligible days",
  },
  {
    action: "daily-log-completed",
    label: "Complete daily log",
    detail: "Advances Weekly Rhythm, and grants XP",
  },
  {
    action: "item-opened-early",
    label: "Open item early",
    detail: "Awards Ready Early",
  },
  {
    action: "on-time-finish",
    label: "Finish on time",
    detail: "Adds a badge, and makes the pet happy",
  },
  {
    action: "late-finish",
    label: "Finish late",
    detail: "Adds a late completion badge",
  },
  {
    action: "duplicate-replayed",
    label: "Replay duplicate",
    detail: "Must not change progress",
  },
];

function SandboxControls({
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
  currentSemesterWeek,
}: {
  client: SandboxPalClient;
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
  currentSemesterWeek: number;
}) {
  const [log, setLog] = useState<string[]>([
    "Sandbox ready — every visible Pal surface uses the real pipeline.",
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

  async function dispatch(action: SandboxAction) {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "reset") {
        await post("/api/sandbox/reset", { learner_id: learnerId });
        lastRequest.current = null;
        client.invalidateAccessToken();
        setLog((current) => ["Persisted learner reset", ...current].slice(0, 6));
        onReset();
        return;
      }

      const requests =
        action === "duplicate-replayed"
          ? (lastRequest.current ? [lastRequest.current] : [])
          : eventsForAction(action, simulatedDate, learnerId);
      if (requests.length > 0) {
        let data: Record<string, unknown> = {};
        for (const request of requests) {
          data = await post("/api/sandbox/events", request);
          if (action !== "duplicate-replayed") lastRequest.current = request;
        }
        const request = requests[requests.length - 1];
        setLog((current) => [
          `→ ${request.event_type}: ${String(data.status)}`,
          ...current,
        ].slice(0, 6));
      } else {
        const detail =
          action === "duplicate-replayed"
            ? "Nothing to replay — send a real event first"
            : "This control does not emit an event";
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

  async function advanceWeek() {
    if (busy || !canAddWeek) return;
    setBusy(true);
    try {
      const nextDate = addDays(simulatedDate, 7);
      const request = eventForAction(
        "week-configured",
        nextDate,
        learnerId,
      );
      if (!request) throw new Error("Could not configure the next sandbox week");
      const data = await post("/api/sandbox/events", request);
      lastRequest.current = request;
      onAddWeek();
      setLog((current) => [
        `→ advanced week: ${String(data.status)}`,
        ...current,
      ].slice(0, 6));
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
              <span className={styles.fixtureLabel}>Real pipeline</span>
              <h2>Semester controls</h2>
            </div>
            <p>
              Controls send version 1 facts through Pal ingest. The roadmap,
              companion, rewards, and acknowledgements all read persisted state.
            </p>
          </header>

          <div className={styles.dateBar}>
            <span className={styles.dateLabel}>
              Semester week {currentSemesterWeek} / daily-log date
            </span>
            <span className={styles.dateValue}>
              {simulatedDate.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <div className={styles.dateButtons}>
              <button type="button" onClick={onAddDay} disabled={busy || !canAddDay} aria-label="Add 1 day">
                +1 day
              </button>
              <button
                type="button"
                onClick={() => void advanceWeek()}
                disabled={busy || !canAddWeek}
                aria-label="Add 1 week and configure it"
              >
                +1 week
              </button>
            </div>
          </div>

          <div className={styles.controlActions}>
            {SANDBOX_ACTIONS.map(({ action, label, detail }) => (
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
  scopeKey,
  onReset,
}: {
  client: SandboxPalClient;
  theme: PalTheme;
  viewport: PalViewport;
  view: HostView;
  onViewChange: (view: HostView) => void;
  onThemeChange: (theme: PalTheme) => void;
  learnerId: string;
  scopeKey: string;
  onReset: () => void;
}) {
  const [simulatedDate, setSimulatedDate] = useState(
    () => new Date(FICTIONAL_SEMESTER_START_ISO),
  );
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const canAddDay = isTodayOrEarlier(addDays(simulatedDate, 1));
  const canAddWeek = isTodayOrEarlier(addDays(simulatedDate, 7));

  const currentSemesterWeek = useMemo(
    () => semesterWeekForDate(simulatedDate),
    [simulatedDate],
  );

  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeLabel =
    NAV_ITEMS.find((item) => item.view === view)?.label ?? "Today";

  return (
    <PalProvider
      key={scopeKey}
      client={client}
      scopeKey={scopeKey}
      density="comfortable"
      motion="system"
      theme={theme}
      viewport={viewport}
      onError={(error) => setSandboxError(error.message)}
      // Moods expire on the engine's timestamp: happy runs 30 minutes and
      // excited an hour. Refreshing reads the durable state against the
      // current clock, so the pet returns to neutral without another event.
      refreshIntervalMs={15_000}
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
                  <span>Host preview</span>
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

          <SandboxRefreshBridge>
            {(refresh) => (
              <SandboxControls
                client={client}
                collapsed={controlsCollapsed}
                onCollapsedChange={setControlsCollapsed}
                onRefresh={refresh}
                onReset={() => {
                  setSimulatedDate(new Date(FICTIONAL_SEMESTER_START_ISO));
                  setSandboxError(null);
                  onReset();
                }}
                simulatedDate={simulatedDate}
                onAddDay={() => setSimulatedDate((prev) => addDays(prev, 1))}
                onAddWeek={() => setSimulatedDate((prev) => addDays(prev, 7))}
                canAddDay={canAddDay}
                canAddWeek={canAddWeek}
                learnerId={learnerId}
                sandboxError={sandboxError}
                currentSemesterWeek={currentSemesterWeek}
              />
            )}
          </SandboxRefreshBridge>
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

function SandboxRefreshBridge({
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
  const [apiBaseUrl, setApiBaseUrl] = useState<string | null>(null);
  const [clientGeneration, setClientGeneration] = useState(0);
  const [theme, setTheme] = useState<PalTheme>("dark");
  const [viewport, setViewport] = useState<PalViewport>("wide");
  const [view, setView] = useState<HostView>("achievements");

  useEffect(() => {
    setApiBaseUrl(window.location.origin);
    const query = window.matchMedia("(max-width: 48rem)");
    const updateViewport = () => setViewport(query.matches ? "narrow" : "wide");
    updateViewport();
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  const client = useMemo(
    () =>
      apiBaseUrl
        ? createSandboxPalClient(learnerId, apiBaseUrl)
        : null,
    [apiBaseUrl, learnerId],
  );

  if (!client) {
    return (
      <main className={styles.sandbox} data-theme={theme}>
        <p role="status">Preparing the Pal sandbox…</p>
      </main>
    );
  }

  return (
    <SandboxExperience
      client={client}
      theme={theme}
      viewport={viewport}
      view={view}
      onViewChange={setView}
      onThemeChange={setTheme}
      learnerId={learnerId}
      scopeKey={`${learnerId}-${clientGeneration}`}
      onReset={() => setClientGeneration((current) => current + 1)}
    />
  );
}
