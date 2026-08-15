import {
  COLLECTION_SYNC,
  DAILY_LOG_REWARD_SETTLED,
  defaultRulePack,
  processEvent,
  PROGRESSION_POLICY,
  WEEKLY_RHYTHM_EARNED,
  type IncomingEvent,
  type LearnerState,
} from "@pal/engine";
import { collectionItemsForUnlocks } from "./collection";
import type {
  PalAchievement,
  PalFixtureAction,
  PalFixtureActionContext,
  PalFixtureController,
  PalRoadmapWeek,
  PalWidgetSnapshot,
} from "./types";
import { createPalProgressionState } from "./progression";
import { MAX_STORY_PERIODS, MIN_STORY_PERIODS } from "./story";

const WEEKLY_RHYTHM_ID = "weekly-rhythm";
const DEFAULT_WEEKLY_TARGET = 4;
const FIRST_GENERATED_ACTIVITY_DAY = "2026-04-13";

function requireFixtureTermWeeks(totalWeeks: number): number {
  if (
    !Number.isInteger(totalWeeks) ||
    totalWeeks < MIN_STORY_PERIODS ||
    totalWeeks > MAX_STORY_PERIODS
  ) {
    throw new Error(
      `Fixture term must contain ${MIN_STORY_PERIODS}–${MAX_STORY_PERIODS} weeks`,
    );
  }
  return totalWeeks;
}

function earnedCollectibleWeeks(weeks: readonly PalRoadmapWeek[]): number[] {
  return weeks.flatMap((week) =>
    week.achievements.some(
      (achievement) =>
        achievement.title === "Weekly Rhythm" && achievement.status === "earned",
    )
      ? [week.number]
      : [],
  );
}

function weeklyRhythm(
  week: number,
  current: number,
  target: number,
  status: PalAchievement["status"],
): PalAchievement {
  return {
    id: `${WEEKLY_RHYTHM_ID}-${week}`,
    title: "Weekly Rhythm",
    description: `Complete daily logs on ${target} eligible days this week.`,
    status,
    statusLabel:
      status === "earned"
        ? "Earned"
        : status === "in-progress"
          ? `${current} of ${target} days`
          : status === "incomplete"
            ? "Not completed"
            : "Upcoming",
    badge: {
      label: "Weekly Rhythm",
      assetUrl: "/assets/badges/badge-checkin-7-day-v1.png",
    },
    progress: { current, target, label: `${current} of ${target} eligible days` },
    rewardLabel: status === "earned" ? "Happy companion" : undefined,
  };
}

function buildWeek(number: number, currentWeek: number): PalRoadmapWeek {
  const status =
    number < currentWeek ? "past" : number === currentWeek ? "current" : "future";
  const achievementStatus =
    status === "past" ? "earned" : status === "current" ? "in-progress" : "upcoming";
  const target = number === 3 ? 3 : 4;
  const progress = status === "past" ? target : status === "current" ? 2 : 0;

  return {
    id: `week-${number}`,
    number,
    label: `Week ${number}`,
    dateLabel: `Semester week ${number}`,
    status,
    summary:
      status === "past"
        ? "Weekly goal earned"
        : status === "current"
          ? "Your current progress"
          : "Opens when the week begins",
    achievements: [weeklyRhythm(number, progress, target, achievementStatus)],
  };
}

function emptyWeek(number: number, currentWeek: number): PalRoadmapWeek {
  const status =
    number < currentWeek ? "past" : number === currentWeek ? "current" : "future";
  return {
    id: `week-${number}`,
    number,
    label: `Week ${number}`,
    dateLabel: `Semester week ${number}`,
    status,
    summary:
      status === "past"
        ? "Week complete"
        : status === "current"
          ? "Your current progress"
          : "Opens when the week begins",
    achievements: [],
  };
}

/** A fresh learner snapshot matching the production snapshot's empty defaults. */
export function createEmptyFixtureSnapshot(totalWeeks = 16): PalWidgetSnapshot {
  requireFixtureTermWeeks(totalWeeks);
  const currentWeek = 1;
  const weeks = Array.from({ length: totalWeeks }, (_, index) =>
    emptyWeek(index + 1, currentWeek),
  );
  const companion = {
    name: "Pip",
    mood: "neutral" as const,
    moodLabel: "Neutral",
    level: 1,
    streak: 0,
    xp: 0,
    xpToNextLevel: 500,
    message: "Complete positive learning actions to encourage Pip.",
    assetUrl: "/assets/pets/default.png",
  };
  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: "Achievement semester",
      currentWeek,
      weeks,
    },
    companion,
    collection: { items: [] },
    rewards: [],
    progression: createPalProgressionState({
      currentWeek,
      totalWeeks: weeks.length,
      level: companion.level,
      streak: companion.streak,
      achievements: [],
      earnedWeeks: earnedCollectibleWeeks(weeks),
    }),
  };
}

export function createFixtureSnapshot(
  currentWeek = 4,
  totalWeeks = 16,
): PalWidgetSnapshot {
  requireFixtureTermWeeks(totalWeeks);
  const boundedCurrentWeek = Math.max(1, Math.min(totalWeeks, currentWeek));
  const weeks = Array.from({ length: totalWeeks }, (_, index) =>
    buildWeek(index + 1, boundedCurrentWeek),
  );

  weeks[0]?.achievements.push({
    id: "first-pika-login",
    title: "First Pika Login",
    description: "Started your first authenticated Pika session.",
    status: "earned",
    statusLabel: "Earned",
    badge: {
      label: "First Pika Login",
      assetUrl: "/assets/badges/badge-first-classroom-login-v1.png",
    },
  });

  const companion = {
    name: "Pip",
    mood: "happy" as const,
    moodLabel: "Happy",
    level: 2,
    streak: 3,
    xp: 230,
    xpToNextLevel: 270,
    message: "Two daily-log days complete this week.",
    assetUrl: "/assets/pets/default.png",
  };

  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: "Fall semester",
      currentWeek: boundedCurrentWeek,
      weeks,
    },
    companion,
    collection: {
      items: collectionItemsForUnlocks(
        PROGRESSION_POLICY.collectionMilestones
          .filter((milestone) => milestone.weeklyRhythms < boundedCurrentWeek)
          .map((milestone) => milestone.assetRefId),
      ),
    },
    rewards: [],
    progression: createPalProgressionState({
      currentWeek: boundedCurrentWeek,
      totalWeeks: weeks.length,
      level: companion.level,
      streak: companion.streak,
      achievements: weeks.flatMap((week) => week.achievements),
      earnedWeeks: earnedCollectibleWeeks(weeks),
    }),
  };
}

function cloneSnapshot(snapshot: PalWidgetSnapshot): PalWidgetSnapshot {
  return structuredClone(snapshot);
}

function refreshProgression(snapshot: PalWidgetSnapshot): void {
  snapshot.progression = createPalProgressionState({
    currentWeek: snapshot.roadmap.currentWeek,
    totalWeeks: snapshot.roadmap.weeks.length,
    level: snapshot.companion.level,
    streak: snapshot.companion.streak,
    achievements: snapshot.roadmap.weeks.flatMap((week) => week.achievements),
    earnedWeeks: earnedCollectibleWeeks(snapshot.roadmap.weeks),
  });
}

export function createFixturePalClient(
  initialSnapshot = createFixtureSnapshot(),
): PalFixtureController {
  let original = cloneSnapshot(initialSnapshot);
  let snapshot = cloneSnapshot(initialSnapshot);
  const completedActivityDays = new Set<string>();
  const acceptedDailyLogCounts = new Map<number, number>();
  const completedItemTokens = new Set<string>();
  const viewedItemTokens = new Set<string>();
  let generatedDayIdentity = 0;
  let generatedItemIdentity = 0;
  let earnedWeeklyRhythms = countEarnedWeeklyRhythms(snapshot);
  let engineState = progressionStateForSnapshot(snapshot);

  function progressionStateForSnapshot(value: PalWidgetSnapshot): LearnerState {
    const xp = value.companion.xp ?? 0;
    return {
      economy: {
        xp,
        xp_lifetime:
          (value.companion.level - 1) * PROGRESSION_POLICY.levelUpCostXp + xp,
        level: value.companion.level,
        streak_current: value.companion.streak,
        // The fixture's first generated source day is Monday 2026-04-13. Seed
        // an existing visible rhythm on the preceding day so the next action
        // advances it instead of resetting an otherwise unexplained counter.
        streak_last_day:
          value.companion.streak > 0 ? "2026-04-12" : null,
        last_event_at: null,
      },
      pet: {
        mood: value.companion.mood,
        mood_expires_at: null,
      },
      world: {
        stage: 0,
        unlocked_object_ids: value.collection?.items.map((item) => item.id) ?? [],
      },
    };
  }

  function countEarnedWeeklyRhythms(value: PalWidgetSnapshot): number {
    return value.roadmap.weeks.reduce(
      (total, week) =>
        total +
        week.achievements.filter(
          (achievement) =>
            achievement.title === "Weekly Rhythm" &&
            achievement.status === "earned",
        ).length,
      0,
    );
  }

  function seedAcceptedDailyLogCounts(value: PalWidgetSnapshot): void {
    acceptedDailyLogCounts.clear();
    for (const week of value.roadmap.weeks) {
      const rhythm = week.achievements.find(
        (achievement) => achievement.title === "Weekly Rhythm",
      );
      acceptedDailyLogCounts.set(week.number, rhythm?.progress?.current ?? 0);
    }
  }

  function eligibleDaysForFixtureRhythm(rhythm: PalAchievement): number {
    // Fixture configurations model the normal five-day week (target four) and
    // the three-day short week (target two), matching weeklyTarget in persistence.
    return Math.min(5, (rhythm.progress?.target ?? DEFAULT_WEEKLY_TARGET) + 1);
  }

  function syncProgression(): void {
    const mood = ["neutral", "happy", "excited", "sleeping"].includes(
      engineState.pet.mood,
    )
      ? (engineState.pet.mood as PalWidgetSnapshot["companion"]["mood"])
      : "neutral";
    snapshot.companion.level = engineState.economy.level;
    snapshot.companion.streak = engineState.economy.streak_current;
    snapshot.companion.xp = engineState.economy.xp;
    snapshot.companion.xpToNextLevel = Math.max(
      0,
      PROGRESSION_POLICY.levelUpCostXp - engineState.economy.xp,
    );
    snapshot.companion.mood = mood;
    snapshot.companion.moodLabel = mood[0].toUpperCase() + mood.slice(1);
    snapshot.companion.message =
      mood === "excited"
        ? "Pip is excited!"
        : mood === "happy"
          ? "Pip is happy about your progress."
          : "Complete positive learning actions to encourage Pip.";
    snapshot.collection = {
      items: collectionItemsForUnlocks(engineState.world.unlocked_object_ids),
    };
    refreshProgression(snapshot);
  }

  function applyProgression(event: IncomingEvent): void {
    engineState = processEvent(event, engineState, defaultRulePack).state;
    syncProgression();
  }

  function itemOccurredAt(): string {
    return new Date(Date.UTC(2026, 3, 13, 12, generatedItemIdentity))
      .toISOString();
  }

  function rewardWeeklyRhythmIfNewlyEarned(
    wasEarned: boolean,
    rhythm: PalAchievement,
    occurredAt: string,
  ): void {
    if (wasEarned || rhythm.status !== "earned") return;
    earnedWeeklyRhythms += 1;
    applyProgression({
      event_type: WEEKLY_RHYTHM_EARNED,
      occurred_at: occurredAt,
      metadata: { weekly_rhythm_count: earnedWeeklyRhythms },
    });
    syncMissingCollection(occurredAt);
  }

  function syncMissingCollection(occurredAt: string): void {
    const missingMilestones = PROGRESSION_POLICY.collectionMilestones.filter(
      (milestone) =>
        earnedWeeklyRhythms >= milestone.weeklyRhythms &&
        !engineState.world.unlocked_object_ids.includes(milestone.assetRefId),
    );
    for (const milestone of missingMilestones) {
      applyProgression({
        event_type: COLLECTION_SYNC,
        occurred_at: occurredAt,
        metadata: { weekly_rhythm_count: milestone.weeklyRhythms },
      });
    }
  }

  function currentWeek(): PalRoadmapWeek {
    const week = snapshot.roadmap.weeks.find(
      (candidate) => candidate.number === snapshot.roadmap.currentWeek,
    );
    if (!week) throw new Error("Fixture current week is missing");
    return week;
  }

  function currentRhythm(): PalAchievement {
    const achievement = ensureCurrentRhythm();
    return achievement;
  }

  function ensureCurrentRhythm(target = DEFAULT_WEEKLY_TARGET): PalAchievement {
    const week = currentWeek();
    const achievement = week.achievements.find((candidate) =>
      candidate.id.startsWith(WEEKLY_RHYTHM_ID),
    );
    if (achievement) return achievement;
    const rhythm = weeklyRhythm(week.number, 0, target, "in-progress");
    week.achievements.push(rhythm);
    return rhythm;
  }

  function addAchievement(week: PalRoadmapWeek, achievement: PalAchievement): void {
    if (!week.achievements.some((candidate) => candidate.id === achievement.id)) {
      week.achievements.push(achievement);
    }
  }

  function itemIdentity(context?: PalFixtureActionContext): string {
    return context?.itemToken ?? `fixture-item-${++generatedItemIdentity}`;
  }

  function queueFishReward(itemToken: string): void {
    const rewardId = `fixture-fish-reward-${itemToken}`;
    if (!snapshot.rewards.some((reward) => reward.id === rewardId)) {
      snapshot.rewards.push({
        id: rewardId,
        title: "A treat for Pip!",
        description: "Your on-time work earned a fish snack.",
        icon: "🐟",
      });
    }
  }

  function queueStoryReward(weekNumber: number, wasEarned: boolean): void {
    if (wasEarned) return;
    const collectible = snapshot.progression?.collectibles.find(
      (candidate) => candidate.roadmapWeek === weekNumber,
    );
    if (!collectible || collectible.status !== "earned" || !collectible.chapterId) {
      return;
    }
    const rewardId = `fixture-story-${collectible.chapterId}`;
    if (snapshot.rewards.some((reward) => reward.id === rewardId)) return;
    snapshot.rewards.unshift({
      id: rewardId,
      kind: "story",
      title: collectible.revealHeadline ?? "A new chapter",
      description: collectible.storyCopy ?? collectible.description,
      collectibleTitle: collectible.title,
      assetUrl: collectible.assetUrl,
      ...(collectible.titleAward
        ? {
            titleAward: collectible.titleAward,
            titleRevealCopy: collectible.titleRevealCopy,
          }
        : {}),
    });
  }

  seedAcceptedDailyLogCounts(snapshot);
  syncMissingCollection(`${FIRST_GENERATED_ACTIVITY_DAY}T12:00:00.000Z`);

  return {
    async getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    async markRewardSeen(rewardId) {
      snapshot.rewards = snapshot.rewards.filter((reward) => reward.id !== rewardId);
    },
    dispatch(action: PalFixtureAction, context?: PalFixtureActionContext) {
      if (action === "reset") {
        snapshot = cloneSnapshot(original);
        completedActivityDays.clear();
        seedAcceptedDailyLogCounts(snapshot);
        completedItemTokens.clear();
        viewedItemTokens.clear();
        generatedDayIdentity = 0;
        generatedItemIdentity = 0;
        earnedWeeklyRhythms = countEarnedWeeklyRhythms(snapshot);
        engineState = progressionStateForSnapshot(snapshot);
        syncMissingCollection("2026-04-13T12:00:00.000Z");
        return "Fixture learner reset";
      }
      if (action === "duplicate-replayed") {
        return "Duplicate replayed — no progress changed";
      }
      if (action === "advance-week") {
        const finalWeek = snapshot.roadmap.weeks.length;
        const nextWeek = Math.min(finalWeek, snapshot.roadmap.currentWeek + 1);
        snapshot.roadmap.currentWeek = nextWeek;
        for (const week of snapshot.roadmap.weeks) {
          week.status =
            week.number < nextWeek
              ? "past"
              : week.number === nextWeek
                ? "current"
                : "future";
          week.summary =
            week.status === "past"
              ? "Week complete"
              : week.status === "current"
                ? "Your current progress"
                : "Opens when the week begins";
        }
        ensureCurrentRhythm();
        refreshProgression(snapshot);
        return nextWeek === finalWeek ? "Moved to final semester week" : `Moved to week ${nextWeek}`;
      }
      if (action === "week-configured") {
        ensureCurrentRhythm();
        return "Created a 5-day Weekly Rhythm target";
      }
      if (action === "short-week-configured") {
        const rhythm = ensureCurrentRhythm(2);
        const wasEarned = rhythm.status === "earned";
        if (rhythm.progress) {
          rhythm.progress.target = 2;
          rhythm.progress.current = Math.min(rhythm.progress.current, 2);
          rhythm.progress.label = `${rhythm.progress.current} of 2 eligible days`;
          rhythm.status = rhythm.progress.current >= 2 ? "earned" : "in-progress";
          rhythm.statusLabel = rhythm.status === "earned" ? "Earned" : rhythm.progress.label;
        }
        rewardWeeklyRhythmIfNewlyEarned(
          wasEarned,
          rhythm,
          itemOccurredAt(),
        );
        return "Revised to a 2-day Weekly Rhythm goal within 3 eligible days";
      }
      if (action === "daily-log-completed") {
        const activityDay =
          context?.activityDay ??
          new Date(Date.UTC(2026, 3, 12 + ++generatedDayIdentity))
            .toISOString()
            .slice(0, 10);
        if (completedActivityDays.has(activityDay)) {
          return "daily_log.completed: semantic duplicate — no progress changed";
        }
        const rhythm = currentRhythm();
        const weekNumber = currentWeek().number;
        const acceptedCount =
          acceptedDailyLogCounts.get(weekNumber) ?? rhythm.progress?.current ?? 0;
        if (acceptedCount >= eligibleDaysForFixtureRhythm(rhythm)) {
          return "daily_log.completed: period limit exceeded — no progress changed";
        }
        const activeCollectibleWasEarned =
          snapshot.progression?.collectibles.find(
            (collectible) => collectible.roadmapWeek === snapshot.roadmap.currentWeek,
          )?.status === "earned";
        completedActivityDays.add(activityDay);
        acceptedDailyLogCounts.set(weekNumber, acceptedCount + 1);
        const wasEarned = rhythm.status === "earned";
        if (rhythm.progress) {
          rhythm.progress.current = Math.min(
            rhythm.progress.target,
            rhythm.progress.current + 1,
          );
          rhythm.progress.label =
            `${rhythm.progress.current} of ${rhythm.progress.target} eligible days`;
          rhythm.status =
            rhythm.progress.current >= rhythm.progress.target ? "earned" : "in-progress";
          rhythm.statusLabel =
              rhythm.status === "earned" ? "Earned" : rhythm.progress.label;
        }
        const occurredAt = `${activityDay}T12:00:00.000Z`;
        applyProgression({
          event_type: "daily_log.completed",
          occurred_at: occurredAt,
          metadata: { activity_day: activityDay },
        });
        applyProgression({
          event_type: DAILY_LOG_REWARD_SETTLED,
          occurred_at: occurredAt,
          metadata: {},
        });
        rewardWeeklyRhythmIfNewlyEarned(wasEarned, rhythm, occurredAt);
        queueStoryReward(snapshot.roadmap.currentWeek, activeCollectibleWasEarned);
        return "daily_log.completed applied to fixture state";
      }
      if (action === "classroom-joined") {
        addAchievement(snapshot.roadmap.weeks[0]!, {
          id: "joined-class",
          title: "Joined the Class",
          description: "Joined a new classroom.",
          status: "earned",
          statusLabel: "Earned",
          badge: {
            label: "Joined the Class",
            assetUrl: "/assets/badges/badge-first-classroom-login-v1.png",
          },
        });
        return "classroom.joined applied to fixture state";
      }
      if (action === "item-opened-early") {
        const week = currentWeek();
        const itemToken = itemIdentity(context);
        if (viewedItemTokens.has(itemToken)) {
          return "learning_item.viewed: semantic duplicate — no progress changed";
        }
        viewedItemTokens.add(itemToken);
        addAchievement(week, {
          id: `ready-early-${itemToken}`,
          title: "Ready Early",
          description: "Opened a learning item soon after it was released.",
          status: "earned",
          statusLabel: "Earned early",
          badge: {
            label: "Ready Early",
            assetUrl: "/assets/badges/badge-ready-early-v1.png",
          },
        });
        return "learning_item.viewed (early) applied to fixture state";
      }
      if (action === "on-time-finish") {
        const week = currentWeek();
        const itemToken = itemIdentity(context);
        if (completedItemTokens.has(itemToken)) {
          return "learning_item.completed: semantic duplicate — no progress changed";
        }
        completedItemTokens.add(itemToken);
        addAchievement(week, {
          id: `on-time-finish-${itemToken}`,
          title: "On-Time Finish",
          description: "Completed a learning item on time.",
          status: "earned",
          statusLabel: "Earned on time",
          badge: {
            label: "On-Time Finish",
            assetUrl: "/assets/badges/badge-on-time-finish.png",
          },
          rewardLabel: "Fish snack",
        });
        queueFishReward(itemToken);
        applyProgression({
          event_type: "learning_item.completed",
          occurred_at: itemOccurredAt(),
          metadata: { timing: "on_time" },
        });
        return "learning_item.completed (on_time) applied to fixture state";
      }
      if (action === "late-finish") {
        const week = currentWeek();
        const itemToken = itemIdentity(context);
        if (completedItemTokens.has(itemToken)) {
          return "learning_item.completed: semantic duplicate — no progress changed";
        }
        completedItemTokens.add(itemToken);
        addAchievement(week, {
          id: `late-finish-${itemToken}`,
          title: "On-Time Finish",
          description: "Completed a learning item late.",
          status: "incomplete",
          statusLabel: "Completed late",
          badge: {
            label: "On-Time Finish",
            assetUrl: "/assets/badges/badge-on-time-finish.png",
          },
        });
        applyProgression({
          event_type: "learning_item.completed",
          occurred_at: itemOccurredAt(),
          metadata: { timing: "late" },
        });
        return "learning_item.completed (late) applied to fixture state";
      }
      if (action === "session-started") {
        addAchievement(snapshot.roadmap.weeks[0]!, {
          id: "first-pika-login",
          title: "First Pika Login",
          description: "Started your first authenticated Pika session.",
          status: "earned",
          statusLabel: "Earned",
          badge: {
            label: "First Pika Login",
            assetUrl: "/assets/badges/badge-first-classroom-login-v1.png",
          },
        });
        return "platform.session.started applied to fixture state";
      }

      queueFishReward(itemIdentity(context));
      return "Fixture reward queued";
    },
    peek() {
      return cloneSnapshot(snapshot);
    },

    setWeek(week: number) {
      const clamped = Math.max(1, Math.min(snapshot.roadmap.weeks.length, week));
      snapshot = createFixtureSnapshot(clamped, snapshot.roadmap.weeks.length);
      completedActivityDays.clear();
      seedAcceptedDailyLogCounts(snapshot);
      completedItemTokens.clear();
      viewedItemTokens.clear();
      earnedWeeklyRhythms = countEarnedWeeklyRhythms(snapshot);
      engineState = progressionStateForSnapshot(snapshot);
      syncMissingCollection(itemOccurredAt());
    },

    setTermWeeks(totalWeeks: number) {
      requireFixtureTermWeeks(totalWeeks);
      snapshot = createFixtureSnapshot(
        Math.min(snapshot.roadmap.currentWeek, totalWeeks),
        totalWeeks,
      );
      original = cloneSnapshot(snapshot);
      completedActivityDays.clear();
      seedAcceptedDailyLogCounts(snapshot);
      completedItemTokens.clear();
      viewedItemTokens.clear();
      earnedWeeklyRhythms = countEarnedWeeklyRhythms(snapshot);
      engineState = progressionStateForSnapshot(snapshot);
      syncMissingCollection(itemOccurredAt());
    },
  };
}
