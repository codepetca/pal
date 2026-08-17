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
export type PalUnlockStatus = "earned" | "next" | "locked";
export type PalCollectibleKind = "companion" | "room" | "cosmetic";
export type PalCollectibleFinish = "sketch" | "color";

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

export type PalAchievementKey =
  | "first-pika-login"
  | "joined-class"
  | "weekly-rhythm"
  | "ready-early"
  | "on-time-finish";

export interface PalAchievementPresentation {
  key: PalAchievementKey;
  title: string;
  description: string;
  badge: PalBadge;
}

export interface PalAchievement {
  id: string;
  /** Stable canonical identity. Optional only for older schema-v1 hosts. */
  key?: PalAchievementKey;
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
  /** Supplied 1-based roadmap cursor consumed by published schema-v1 widgets. */
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

/**
 * Backward-compatible schema-v1 reward surface. Hosts may continue reading the
 * original optional grant fields without first narrowing a newer achievement
 * celebration variant.
 */
export interface PalRewardNotice {
  id: string;
  title: string;
  description: string;
  kind?: "standard" | "story";
  collectibleTitle?: string;
  /** Sketch is the guaranteed story keepsake; color marks an earned Weekly Rhythm. */
  collectibleFinish?: PalCollectibleFinish;
  titleAward?: string;
  titleRevealCopy?: string;
  icon?: string;
  assetUrl?: string;
  achievement?: PalAchievementPresentation & {
    /** Stable earned achievement-instance identity used by the roadmap. */
    id: string;
  };
}

export interface PalGrantRewardNotice extends PalRewardNotice {
  achievement?: never;
}

export interface PalAchievementCelebrationNotice extends PalRewardNotice {
  /** Transient acknowledgement identity. */
  id: string;
  kind: "achievement";
  /** Presentation-safe identity selected by the authenticated Pal server. */
  achievement: PalAchievementPresentation & {
    /** Stable earned achievement-instance identity used by the roadmap. */
    id: string;
  };
}

export interface PalCollectionItem {
  id: string;
  label: string;
  description: string;
  icon?: string;
  assetUrl?: string;
}

export interface PalCollectionState {
  items: PalCollectionItem[];
}

interface PalCollectibleUnlockBase {
  id: string;
  /** Roadmap week whose collectible slot reveals this reward after it is earned. */
  roadmapWeek: number;
  statusLabel: string;
  progress?: PalProgress;
}

export type PalCollectibleUnlock =
  | PalCollectibleUnlockBase & {
      status: "earned";
      /** Stable story chapter identity. */
      chapterId?: string;
      title: string;
      description: string;
      revealHeadline?: string;
      storyCopy?: string;
      titleAward?: string;
      titleRevealCopy?: string;
      kind: PalCollectibleKind;
      /** Presentation tier. Older schema-v1 producers omit this and render in color. */
      finish?: PalCollectibleFinish;
      assetUrl: string;
    }
  | PalCollectibleUnlockBase & {
      status: "next" | "locked";
    };

export type PalTitleUnlock = {
  id: string;
  statusLabel: string;
} & (
  | {
      status: "earned";
      label: string;
      description: string;
    }
  | {
      status: "next" | "locked";
    }
);

/** Display-ready companion decision emitted by Pal's canonical projector. */
export type PalCompanionReveal =
  | {
      status: "locked";
      label: string;
      /** The only mystery artwork the widget may display before the reveal. */
      assetUrl?: string;
    }
  | {
      status: "earned";
      /** The only companion artwork the widget may display after the reveal. */
      assetUrl: string;
    };

export interface PalProgressionState {
  companionReveal: PalCompanionReveal;
  currentTitle?: string;
  collectibles: PalCollectibleUnlock[];
  titles: PalTitleUnlock[];
}

export interface PalWidgetSnapshot {
  schemaVersion: 1;
  roadmap: PalRoadmapSnapshot;
  companion: PalCompanionState;
  /** Durable world keepsakes. Optional for backward-compatible v1 snapshots. */
  collection?: PalCollectionState;
  rewards: PalRewardNotice[];
  /** Optional in schema v1 so older Pal APIs remain compatible. */
  progression?: PalProgressionState;
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
  /** Override the current week number, bounded by the supplied roadmap. */
  setWeek?(week: number): void;
  /** Rebuild the fixture with a supported 6–24 period story plan. */
  setTermWeeks?(weeks: number): void;
}
