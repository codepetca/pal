"use client";

import {
  PalAchievements,
  PalCompanion,
  PalProvider,
  PalRewardCelebration,
  type PalFixtureAction,
  type PalFixtureActionContext,
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
  Gear,
  Lightning,
  Megaphone,
  Moon,
  NotePencil,
  Sun,
  Trophy,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createSandboxPalClient,
  type SandboxPalClient,
} from "./sandbox-client";
import { createStoryFixturePalClient } from "./fixture-story-client";
import {
  addDays,
  eventForAction,
  eventsForAction,
  FICTIONAL_SEMESTER_START_ISO,
  isTodayOrEarlier,
  isInsideFictionalSemester,
  semesterWeekForDate,
  type SandboxAction,
} from "./sandbox-events";
import styles from "./widget-sandbox.module.css";

type HostView =
  | "today"
  | "achievements"
  | "classwork"
  | "tests"
  | "calendar"
  | "syllabus"
  | "announcements"
  | "settings";

export type SandboxBuildInfo = {
  widgetVersion: string;
  revision?: string;
};

export type SandboxMode = "fixture" | "persisted";

type SandboxClient = PalFixtureController | SandboxPalClient;

function isFixtureClient(client: SandboxClient): client is PalFixtureController {
  return "dispatch" in client;
}

const NAV_ITEMS = [
  { label: "Today", view: "today", icon: NotePencil },
  { label: "Classwork", view: "classwork", icon: ClipboardText },
  { label: "Tests", view: "tests", icon: FileText },
  { label: "Calendar", view: "calendar", icon: CalendarBlank },
  { label: "Syllabus", view: "syllabus", icon: BookOpen },
  { label: "Achievements", view: "achievements", icon: Trophy },
  { label: "Announcements", view: "announcements", icon: Megaphone },
  { label: "Settings", view: "settings", icon: Gear },
] satisfies Array<{
  label: string;
  view: HostView;
  icon: typeof NotePencil;
}>;

const SANDBOX_ACTION_GROUPS: Array<{
  id: "student" | "pika";
  label: string;
  actions: Array<{ action: SandboxAction; label: string }>;
}> = [
  {
    id: "student",
    label: "Student initiated",
    actions: [
      { action: "session-started", label: "Start session" },
      { action: "classroom-joined", label: "Join classroom" },
      { action: "daily-log-completed", label: "Complete daily log" },
      { action: "item-opened-early", label: "Open item early" },
      { action: "on-time-finish", label: "Finish on time" },
      { action: "late-finish", label: "Finish late" },
    ],
  },
  {
    id: "pika",
    label: "Pika initiated",
    actions: [
      { action: "week-configured", label: "Configure this week" },
      { action: "short-week-configured", label: "Make it a short week" },
    ],
  },
];

function CompactMonthCalendar({
  date,
  startDate,
}: {
  date: Date;
  startDate: Date;
}) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const currentDay = date.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const selectedDayKey = date.toISOString().slice(0, 10);
  const startDayKey = startDate.toISOString().slice(0, 10);
  const monthLabel = date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const selectedDateLabel = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div
      className={styles.monthStrip}
      role="img"
      aria-label={`${monthLabel} calendar. ${selectedDateLabel} selected. Elapsed semester days are highlighted.`}
      style={{ "--month-days": daysInMonth } as CSSProperties}
    >
      {Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
        const dayKey = `${monthPrefix}${String(day).padStart(2, "0")}`;

        return (
          <span
            aria-hidden="true"
            className={styles.monthDay}
            data-completed={
              dayKey >= startDayKey && dayKey < selectedDayKey ? "true" : "false"
            }
            data-current={day === currentDay ? "true" : "false"}
            data-weekend={weekday === 0 || weekday === 6 ? "true" : "false"}
            key={day}
          >
            {day}
          </span>
        );
      })}
    </div>
  );
}

function SandboxControls({
  buildInfo,
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
  totalSemesterWeeks,
  onTermWeeksChange,
}: {
  buildInfo: SandboxBuildInfo;
  client: SandboxClient;
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
  totalSemesterWeeks: number;
  onTermWeeksChange: (weeks: number) => void;
}) {
  const fixture = isFixtureClient(client);
  const compactWidgetVersion = buildInfo.widgetVersion.replace(
    /^\d+\.\d+\.\d+-/,
    "",
  );
  const buildStamp = [
    `@codepet/pal-widget-${compactWidgetVersion}`,
    buildInfo.revision,
  ]
    .filter(Boolean)
    .join(" ");
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousCollapsed = useRef(collapsed);

  useEffect(() => {
    if (previousCollapsed.current === collapsed) return;
    if (collapsed) openButtonRef.current?.focus();
    else closeButtonRef.current?.focus();
    previousCollapsed.current = collapsed;
  }, [collapsed]);

  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.error ?? `request failed (${res.status})`));
    }
  }

  async function dispatch(action: SandboxAction) {
    if (busy) return;
    setBusy(true);
    setControlError(null);
    try {
      const activityDay = simulatedDate.toISOString().slice(0, 10);
      if (isFixtureClient(client)) {
        const context: PalFixtureActionContext | undefined =
          action === "daily-log-completed"
            ? { activityDay }
            : action === "item-opened-early" ||
                action === "on-time-finish" ||
                action === "late-finish"
              ? { itemToken: crypto.randomUUID() }
              : undefined;
        client.dispatch(action as PalFixtureAction, context);
        if (action === "reset") {
          onReset();
        }
        await onRefresh();
        return;
      }

      if (action === "reset") {
        await post("/api/sandbox/reset", { learner_id: learnerId });
        client.invalidateAccessToken();
        onReset();
        return;
      }

      const requests = eventsForAction(action, simulatedDate, learnerId);
      if (requests.length > 0) {
        for (const request of requests) {
          await post("/api/sandbox/events", request);
        }
      }
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      setControlError(`Pipeline error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function advanceWeek() {
    if (busy || !canAddWeek) return;
    setBusy(true);
    setControlError(null);
    try {
      if (isFixtureClient(client)) {
        client.dispatch("advance-week");
        onAddWeek();
        await onRefresh();
        return;
      }

      const nextDate = addDays(simulatedDate, 7);
      const request = eventForAction(
        "week-configured",
        nextDate,
        learnerId,
      );
      if (!request) throw new Error("Could not configure the next sandbox week");
      await post("/api/sandbox/events", request);
      onAddWeek();
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      setControlError(`Pipeline error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeTermWeeks(totalWeeks: number) {
    if (!fixture || busy || !client.setTermWeeks) return;
    setBusy(true);
    setControlError(null);
    try {
      client.setTermWeeks(totalWeeks);
      onTermWeeksChange(totalWeeks);
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sandbox request failed";
      setControlError(`Pipeline error: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  const openButton = collapsed ? (
    <button
      ref={openButtonRef}
      className={styles.controlOpen}
      type="button"
      aria-expanded={false}
      aria-controls="sandbox-control-panel"
      aria-label="Open sandbox controls"
      title="Open sandbox controls"
      onClick={() => onCollapsedChange(false)}
    >
      <Lightning aria-hidden="true" size={17} weight="fill" />
      <span>Open sandbox controls</span>
    </button>
  ) : null;

  const closeButton = !collapsed ? (
    <button
      ref={closeButtonRef}
      className={styles.controlClose}
      type="button"
      aria-label="Close sandbox controls"
      onClick={() => onCollapsedChange(true)}
    >
      <X aria-hidden="true" size={18} weight="bold" />
    </button>
  ) : null;

  return (
    <aside
      className={styles.controls}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Fictional semester controls"
    >
      {collapsed ? (
        openButton
      ) : (
        <div id="sandbox-control-panel" className={styles.controlPanel}>
          {closeButton}

          <p className={styles.buildInfo} aria-label="Sandbox build information">
            {buildStamp}
          </p>

          <div className={styles.dateBar}>
            <span className={styles.dateValue}>
              {simulatedDate.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
              <small>W{currentSemesterWeek}/{totalSemesterWeeks}</small>
            </span>
            <div className={styles.dateButtons}>
              <button type="button" onClick={onAddDay} disabled={busy || !canAddDay} aria-label="Add 1 day">
                +day
              </button>
              <button
                type="button"
                onClick={() => void advanceWeek()}
                disabled={busy || !canAddWeek}
                aria-label={
                  fixture && currentSemesterWeek === totalSemesterWeeks
                    ? "Finish semester story"
                    : "Add 1 week and configure it"
                }
              >
                {fixture && currentSemesterWeek === totalSemesterWeeks
                  ? "Finish story"
                  : "+week"}
              </button>
            </div>
            <CompactMonthCalendar
              date={simulatedDate}
              startDate={new Date(FICTIONAL_SEMESTER_START_ISO)}
            />
          </div>

          <div className={styles.controlActions}>
            {SANDBOX_ACTION_GROUPS.map((group) => (
              <section className={styles.actionGroup} key={group.id}>
                <h3>{group.label}</h3>
                <div>
                  {group.actions.map(({ action, label }) => (
                    <button
                      type="button"
                      key={action}
                      disabled={busy}
                      onClick={() => void dispatch(action)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {group.id === "pika" && fixture ? (
                  <label className={styles.termLength}>
                    Story length
                    <select
                      aria-label="Fixture story length"
                      disabled={busy}
                      value={totalSemesterWeeks}
                      onChange={(event) => void changeTermWeeks(Number(event.target.value))}
                    >
                      {Array.from({ length: 19 }, (_, index) => index + 6).map((weeks) => (
                        <option key={weeks} value={weeks}>{weeks} weeks</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </section>
            ))}
          </div>

          {controlError || sandboxError ? (
            <p className={styles.controlError} role="alert">
              {controlError ?? `Pipeline error: ${sandboxError}`}
            </p>
          ) : null}

          <button
            className={styles.resetButton}
            type="button"
            disabled={busy}
            onClick={() => void dispatch("reset")}
          >
            Reset fictional learner
          </button>
        </div>
      )}
    </aside>
  );
}

function PalSettings({
  widgetScale,
  widgetVisible,
  onWidgetScaleChange,
  onWidgetVisibleChange,
}: {
  widgetScale: number;
  widgetVisible: boolean;
  onWidgetScaleChange: (scale: number) => void;
  onWidgetVisibleChange: (visible: boolean) => void;
}) {
  return (
    <section className={styles.settingsContent} aria-labelledby="settings-title">
      <p className={styles.hostEyebrow}>Pika host preview</p>
      <h1 id="settings-title">Settings</h1>

      <section className={styles.settingsSection} aria-labelledby="pal-settings-title">
        <header className={styles.settingsSectionHeader}>
          <h2 id="pal-settings-title">Pal</h2>
          <p>Widget control</p>
        </header>

        <div className={styles.settingsGrid}>
          <article className={styles.settingCard}>
            <div className={styles.settingTitleRow}>
              <div>
                <h3>Widget size</h3>
                <p>Adjust the size of the Pal widget.</p>
              </div>
              <output htmlFor="pal-widget-size">{widgetScale.toFixed(1)}×</output>
            </div>
            <input
              id="pal-widget-size"
              className={styles.sizeSlider}
              type="range"
              min="0.4"
              max="1.2"
              step="0.1"
              value={widgetScale}
              aria-label="Pal widget size"
              onInput={(event) => onWidgetScaleChange(Number(event.currentTarget.value))}
            />
            <div className={styles.sliderBounds} aria-hidden="true">
              <span>0.4×</span>
              <span>1.2×</span>
            </div>
          </article>

          <article className={styles.settingCard}>
            <div className={styles.settingTitleRow}>
              <div>
                <h3>Show widget</h3>
                <p>Show or hide the Pal widget.</p>
              </div>
              <span className={styles.settingStatus}>
                {widgetVisible ? "On" : "Off"}
              </span>
            </div>
            <label className={styles.switchControl}>
              <input
                type="checkbox"
                role="switch"
                checked={widgetVisible}
                aria-label="Show Pal widget"
                onChange={(event) => onWidgetVisibleChange(event.currentTarget.checked)}
              />
              <span className={styles.switchTrack} aria-hidden="true">
                <span />
              </span>
              <span>{widgetVisible ? "Widget visible" : "Widget hidden"}</span>
            </label>
          </article>
        </div>
      </section>
    </section>
  );
}

function CompanionOverlay({
  visible,
  scale,
  dragging,
  overlayRef,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  visible: boolean;
  scale: number;
  dragging: boolean;
  overlayRef: RefObject<HTMLDivElement | null>;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerEnd: () => void;
}) {
  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className={styles.companionOverlay}
      data-dragging={dragging ? "true" : "false"}
    >
      <PalCompanion
        scale={scale}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDragStart={(event) => event.preventDefault()}
      />
    </div>
  );
}

function SandboxExperience({
  buildInfo,
  client,
  mode,
  theme,
  viewport,
  view,
  onViewChange,
  onThemeChange,
  learnerId,
  scopeKey,
  onReset,
}: {
  buildInfo: SandboxBuildInfo;
  client: SandboxClient;
  mode: SandboxMode;
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
  const fixture = isFixtureClient(client);
  const [termWeeks, setTermWeeks] = useState(() =>
    fixture ? client.peek().roadmap.weeks.length : 16,
  );
  const nextDay = addDays(simulatedDate, 1);
  const nextWeek = addDays(simulatedDate, 7);
  const canAddDay =
    isTodayOrEarlier(nextDay) &&
    semesterWeekForDate(nextDay) <= termWeeks &&
    (fixture || isInsideFictionalSemester(nextDay));
  const simulatedSemesterWeek = semesterWeekForDate(simulatedDate);
  const canAddWeek =
    (simulatedSemesterWeek < termWeeks ||
      (fixture && simulatedSemesterWeek === termWeeks)) &&
    isTodayOrEarlier(nextWeek) &&
    (fixture || isInsideFictionalSemester(nextWeek));

  const currentSemesterWeek = useMemo(
    () => Math.min(termWeeks, semesterWeekForDate(simulatedDate)),
    [simulatedDate, termWeeks],
  );

  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [widgetScale, setWidgetScale] = useState(1);
  const [widgetVisible, setWidgetVisible] = useState(true);

  useEffect(() => {
    if (sandboxError) setControlsCollapsed(false);
    if (sandboxError) setSidebarCollapsed(false);
  }, [sandboxError]);

  // Host-owned placement (per the widget's boundary: "the host owns
  // placement, Pal owns everything rendered inside"). Position is written
  // straight to the DOM node during drag rather than through setState:
  // this component's subtree is large, and re-rendering it on every
  // pointermove was what made dragging feel laggy. State only records
  // whether a drag is in progress, for the grab/grabbing cursor.
  const companionOverlayRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<HTMLDivElement>(null);
  const [companionDragging, setCompanionDragging] = useState(false);
  const companionPosition = useRef<{ x: number; y: number } | null>(null);
  // Width/height are the public pet widget's complete visual footprint,
  // captured once at drag start so each move only clamps against them instead
  // of re-measuring the DOM every pointer event.
  const companionDragOffset = useRef<{
    dx: number;
    dy: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const overlay = companionOverlayRef.current;
    if (!overlay) return;

    const clampToContainer = () => {
      const rect = overlay.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const container = overlay.offsetParent;
      const containerRect = container instanceof HTMLElement
        ? container.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const maxX = Math.max(containerRect.width - rect.width, 0);
      const maxY = Math.max(containerRect.height - rect.height, 0);
      const x = Math.min(Math.max(rect.left - containerRect.left, 0), maxX);
      const y = Math.min(Math.max(rect.top - containerRect.top, 0), maxY);

      overlay.style.left = `${x}px`;
      overlay.style.top = `${y}px`;
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
    };

    clampToContainer();
    window.addEventListener("resize", clampToContainer);
    const resizeObserver = new ResizeObserver(clampToContainer);
    resizeObserver.observe(overlay);

    return () => {
      window.removeEventListener("resize", clampToContainer);
      resizeObserver.disconnect();
    };
  }, [widgetScale, widgetVisible]);

  // Pal owns the surface's internal alpha hit-test. Pointer capture and the
  // resulting viewport placement remain host responsibilities.
  const handleCompanionPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = companionOverlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const container = el.offsetParent;
    const containerRect = container instanceof HTMLElement
      ? container.getBoundingClientRect()
      : { left: 0, top: 0 };
    companionDragOffset.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    const x = rect.left - containerRect.left;
    const y = rect.top - containerRect.top;
    companionPosition.current = { x, y };
    // Pin the current on-screen position as explicit left/top before
    // anything else — rect already IS wherever it's sitting right now
    // (whether that's the CSS default right/bottom corner or a previous
    // drag's left/top), so this is a no-op visually. It guarantees the
    // sprite cannot move on press itself, only from here on with the
    // pointer, regardless of how that position was arrived at.
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    e.currentTarget.setPointerCapture(e.pointerId);
    setCompanionDragging(true);
  };

  const handleCompanionPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const el = companionOverlayRef.current;
    const offset = companionDragOffset.current;
    if (!el || !offset) return;
    // Convert viewport pointer coordinates to the positioned classroom shell's
    // coordinate space before clamping against its visible bounds.
    const container = el.offsetParent;
    const containerRect = container instanceof HTMLElement
      ? container.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const maxX = Math.max(containerRect.width - offset.width, 0);
    const maxY = Math.max(containerRect.height - offset.height, 0);
    const x = Math.min(
      Math.max(e.clientX - offset.dx - containerRect.left, 0),
      maxX,
    );
    const y = Math.min(
      Math.max(e.clientY - offset.dy - containerRect.top, 0),
      maxY,
    );
    companionPosition.current = { x, y };
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };

  const endCompanionDrag = () => {
    companionDragOffset.current = null;
    setCompanionDragging(false);
  };

  useEffect(() => {
    const sandbox = sandboxRef.current;
    const el = companionOverlayRef.current;
    const container = el?.offsetParent;

    if (!sandbox || !el || !(container instanceof HTMLElement)) {
      sandbox?.style.setProperty("--companion-width", "0px");
      sandbox?.style.setProperty("--companion-height", "0px");
      return;
    }

    const syncCompanionLayout = () => {
      const companionRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      sandbox.style.setProperty("--companion-width", `${companionRect.width}px`);
      sandbox.style.setProperty("--companion-height", `${companionRect.height}px`);

      const position = companionPosition.current;
      if (!position) return;

      const maxX = Math.max(containerRect.width - companionRect.width, 0);
      const maxY = Math.max(containerRect.height - companionRect.height, 0);
      el.style.left = `${Math.min(Math.max(position.x, 0), maxX)}px`;
      el.style.top = `${Math.min(Math.max(position.y, 0), maxY)}px`;
    };

    syncCompanionLayout();
    const observer = new ResizeObserver(syncCompanionLayout);
    observer.observe(container);
    observer.observe(el);
    return () => observer.disconnect();
  }, [widgetVisible]);

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
      refreshIntervalMs={mode === "persisted" ? 15_000 : 0}
    >
      <div
        ref={sandboxRef}
        className={styles.sandbox}
        data-theme={theme}
      >
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
            <div
              className={styles.navItems}
              inert={!controlsCollapsed || undefined}
            >
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
            <div className={styles.sidebarFooter}>
              <SandboxRefreshBridge>
                {(refresh) => (
                  <SandboxControls
                    buildInfo={buildInfo}
                    client={client}
                    collapsed={controlsCollapsed}
                    onCollapsedChange={(collapsed) => {
                      setControlsCollapsed(collapsed);
                      if (!collapsed) setSidebarCollapsed(false);
                    }}
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
                    totalSemesterWeeks={termWeeks}
                    onTermWeeksChange={(weeks) => {
                      setTermWeeks(weeks);
                      setSimulatedDate((current) => {
                        const currentWeek = semesterWeekForDate(current, 24);
                        return currentWeek <= weeks
                          ? current
                          : addDays(
                              new Date(FICTIONAL_SEMESTER_START_ISO),
                              (weeks - 1) * 7,
                            );
                      });
                    }}
                  />
                )}
              </SandboxRefreshBridge>
              <button
                className={styles.sidebarToggle}
                type="button"
                inert={!controlsCollapsed || undefined}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                {sidebarCollapsed ? (
                  <CaretRight aria-hidden="true" size={23} />
                ) : (
                  <CaretLeft aria-hidden="true" size={23} />
                )}
              </button>
            </div>
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
            ) : view === "settings" ? (
              <PalSettings
                widgetScale={widgetScale}
                widgetVisible={widgetVisible}
                onWidgetScaleChange={setWidgetScale}
                onWidgetVisibleChange={setWidgetVisible}
              />
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

          <CompanionOverlay
            visible={widgetVisible}
            scale={widgetScale}
            dragging={companionDragging}
            overlayRef={companionOverlayRef}
            onPointerDown={handleCompanionPointerDown}
            onPointerMove={handleCompanionPointerMove}
            onPointerEnd={endCompanionDrag}
          />

          </div>

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

export function WidgetSandbox({
  buildInfo,
  mode,
}: {
  buildInfo: SandboxBuildInfo;
  mode: SandboxMode;
}) {
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
    () => {
      if (!apiBaseUrl) return null;
      if (mode === "fixture") {
        return createStoryFixturePalClient(apiBaseUrl);
      }
      return createSandboxPalClient(learnerId, apiBaseUrl);
    },
    [apiBaseUrl, learnerId, mode],
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
      buildInfo={buildInfo}
      client={client}
      mode={mode}
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
