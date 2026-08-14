import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type PalTheme = "light" | "dark";
export type PalDensity = "compact" | "comfortable";
export type PalMotion = "system" | "reduced";
export type PalViewport = "narrow" | "wide";
export type PalAchievementStatus =
  | "earned"
  | "in-progress"
  | "incomplete"
  | "upcoming";
export type PalWeekStatus = "past" | "current" | "future";
export type PalCompanionMood = "neutral" | "happy" | "excited" | "sleeping";

export interface PalProgress {
  current: number;
  target: number;
  label: string;
}

export interface PalBadge {
  label: string;
  icon?: string;
  assetUrl?: string;
}

export interface PalAchievement {
  id: string;
  title: string;
  description: string;
  status: PalAchievementStatus;
  statusLabel: string;
  badge: PalBadge;
  progress?: PalProgress;
  rewardLabel?: string;
}

export interface PalRoadmapWeek {
  id: string;
  number: number;
  label: string;
  dateLabel: string;
  status: PalWeekStatus;
  summary: string;
  achievements: PalAchievement[];
}

export interface PalRoadmapSnapshot {
  semesterLabel: string;
  /** Zero means the selected term exists but its first week has not opened. */
  currentWeek: number;
  weeks: PalRoadmapWeek[];
}

export interface PalCompanionState {
  name: string;
  mood: PalCompanionMood;
  moodLabel: string;
  level: number;
  streak: number;
  /** Current XP balance, when supplied by the host. */
  xp?: number;
  /** Remaining XP before the next level, when supplied by the host. */
  xpToNextLevel?: number;
  message: string;
  assetUrl?: string;
}

export interface PalRewardNotice {
  id: string;
  title: string;
  description: string;
  icon?: string;
  assetUrl?: string;
}

export interface PalWidgetSnapshot {
  schemaVersion: 1;
  roadmap: PalRoadmapSnapshot;
  companion: PalCompanionState;
  rewards: PalRewardNotice[];
}

export interface PalClient {
  getSnapshot(signal?: AbortSignal): Promise<PalWidgetSnapshot>;
  markRewardSeen(rewardId: string, signal?: AbortSignal): Promise<void>;
}

export interface PalProviderProps {
  children: ReactNode;
  client: PalClient;
  /**
   * Host-local opaque key for the active learner context. It is never sent to
   * Pal and must change before the host switches learners.
   */
  scopeKey: string;
  theme?: PalTheme;
  density?: PalDensity;
  motion?: PalMotion;
  viewport?: PalViewport;
  initialSnapshot?: PalWidgetSnapshot;
  refreshIntervalMs?: number;
  onError?: (error: Error) => void;
}

export interface PalCompanionProps
  extends Omit<ComponentPropsWithoutRef<"aside">, "children"> {
  /** Scale for the pet surface. Values are clamped to 0.4–1.2. */
  scale?: number;
}

export type PalFixtureAction =
  | "advance-week"
  | "classroom-joined"
  | "daily-log-completed"
  | "item-opened-early"
  | "on-time-finish"
  | "late-finish"
  | "short-week-configured"
  | "week-configured"
  | "reward-earned"
  | "duplicate-replayed"
  | "session-started"
  | "reset";

export interface PalFixtureActionContext {
  /** Stable source date used to deduplicate one daily log per activity day. */
  activityDay?: string;
  /** Stable source identity used to distinguish genuine learning items. */
  itemToken?: string;
}

export interface PalFixtureController extends PalClient {
  dispatch(action: PalFixtureAction, context?: PalFixtureActionContext): string;
  peek(): PalWidgetSnapshot;
  /** Override the current week number (1-16), rebuilding the snapshot. */
  setWeek?(week: number): void;
}
