import type {
  PalAchievement,
  PalFixtureAction,
  PalFixtureActionContext,
  PalFixtureController,
  PalRoadmapWeek,
  PalWidgetSnapshot,
} from "./types";

const WEEKLY_RHYTHM_ID = "weekly-rhythm";
const DEFAULT_WEEKLY_TARGET = 4;

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
export function createEmptyFixtureSnapshot(): PalWidgetSnapshot {
  const currentWeek = 1;
  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: "Achievement semester",
      currentWeek,
      weeks: Array.from({ length: 16 }, (_, index) =>
        emptyWeek(index + 1, currentWeek),
      ),
    },
    companion: {
      name: "Pip",
      mood: "neutral",
      moodLabel: "Neutral",
      level: 1,
      streak: 0,
      xp: 0,
      xpToNextLevel: 500,
      message: "Complete positive learning actions to encourage Pip.",
      assetUrl: "/assets/pets/default.png",
    },
    rewards: [],
  };
}

export function createFixtureSnapshot(currentWeek = 4): PalWidgetSnapshot {
  const weeks = Array.from({ length: 16 }, (_, index) =>
    buildWeek(index + 1, currentWeek),
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

  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: "Fall semester",
      currentWeek,
      weeks,
    },
    companion: {
      name: "Pip",
      mood: "happy",
      moodLabel: "Happy",
      level: 2,
      streak: 3,
      xp: 230,
      xpToNextLevel: 270,
      message: "Two daily-log days complete this week.",
      assetUrl: "/assets/pets/default.png",
    },
    rewards: [],
  };
}

function cloneSnapshot(snapshot: PalWidgetSnapshot): PalWidgetSnapshot {
  return structuredClone(snapshot);
}

export function createFixturePalClient(
  initialSnapshot = createFixtureSnapshot(),
): PalFixtureController {
  const original = cloneSnapshot(initialSnapshot);
  let snapshot = cloneSnapshot(initialSnapshot);
  const completedActivityDays = new Set<string>();
  const completedItemTokens = new Set<string>();
  const viewedItemTokens = new Set<string>();
  let generatedDayIdentity = 0;
  let generatedItemIdentity = 0;

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

  function setHappyCompanion(): void {
    snapshot.companion.mood = "happy";
    snapshot.companion.moodLabel = "Happy";
    snapshot.companion.message = "Pip is happy about your progress.";
  }

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
        completedItemTokens.clear();
        viewedItemTokens.clear();
        generatedDayIdentity = 0;
        generatedItemIdentity = 0;
        return "Fixture learner reset";
      }
      if (action === "duplicate-replayed") {
        return "Duplicate replayed — no progress changed";
      }
      if (action === "advance-week") {
        const nextWeek = Math.min(16, snapshot.roadmap.currentWeek + 1);
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
        return nextWeek === 16 ? "Moved to final semester week" : `Moved to week ${nextWeek}`;
      }
      if (action === "week-configured") {
        ensureCurrentRhythm();
        return "Created a 5-day Weekly Rhythm target";
      }
      if (action === "short-week-configured") {
        const rhythm = ensureCurrentRhythm(2);
        if (rhythm.progress) {
          rhythm.progress.target = 2;
          rhythm.progress.current = Math.min(rhythm.progress.current, 2);
          rhythm.progress.label = `${rhythm.progress.current} of 2 eligible days`;
          rhythm.status = rhythm.progress.current >= 2 ? "earned" : "in-progress";
          rhythm.statusLabel = rhythm.status === "earned" ? "Earned" : rhythm.progress.label;
        }
        return "Revised Weekly Rhythm to 3 eligible days";
      }
      if (action === "daily-log-completed") {
        const activityDay =
          context?.activityDay ?? `fixture-day-${++generatedDayIdentity}`;
        if (completedActivityDays.has(activityDay)) {
          return "daily_log.completed: semantic duplicate — no progress changed";
        }
        completedActivityDays.add(activityDay);
        const rhythm = currentRhythm();
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
        snapshot.companion.streak += 1;
        snapshot.companion.xp = (snapshot.companion.xp ?? 0) + 10;
        snapshot.companion.xpToNextLevel = Math.max(
          0,
          500 - (snapshot.companion.xp ?? 0),
        );
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
        setHappyCompanion();
        snapshot.companion.xp = (snapshot.companion.xp ?? 0) + 200;
        snapshot.companion.xpToNextLevel = Math.max(
          0,
          500 - (snapshot.companion.xp ?? 0),
        );
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
        setHappyCompanion();
        snapshot.companion.xp = (snapshot.companion.xp ?? 0) + 150;
        snapshot.companion.xpToNextLevel = Math.max(
          0,
          500 - (snapshot.companion.xp ?? 0),
        );
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
      const clamped = Math.max(1, Math.min(16, week));
      snapshot = createFixtureSnapshot(clamped);
      completedActivityDays.clear();
      completedItemTokens.clear();
      viewedItemTokens.clear();
    },
  };
}
