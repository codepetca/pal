import type { ReactNode } from "react";

export type PalTheme = "light" | "dark";
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
  currentWeek: number;
  weeks: PalRoadmapWeek[];
}

export interface PalCompanionState {
  name: string;
  mood: PalCompanionMood;
  moodLabel: string;
  level: number;
  streak: number;
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
  theme?: PalTheme;
  initialSnapshot?: PalWidgetSnapshot;
  refreshIntervalMs?: number;
  onError?: (error: Error) => void;
}

export interface PalCompanionProps {
  variant?: "responsive" | "card" | "compact";
}

export type PalFixtureAction =
  | "advance-week"
  | "daily-log-completed"
  | "on-time-finish"
  | "reward-earned"
  | "duplicate-replayed"
  | "reset";

export interface PalFixtureController extends PalClient {
  dispatch(action: PalFixtureAction): string;
  peek(): PalWidgetSnapshot;
}
