import type {
  PalAchievement,
  PalFixtureAction,
  PalFixtureController,
  PalRoadmapWeek,
  PalWidgetSnapshot,
} from "./types";

const WEEKLY_RHYTHM_ID = "weekly-rhythm";

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
    badge: { label: "Weekly Rhythm", icon: "♫" },
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
    badge: { label: "First Pika Login", icon: "★" },
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

  function currentWeek(): PalRoadmapWeek {
    const week = snapshot.roadmap.weeks.find(
      (candidate) => candidate.number === snapshot.roadmap.currentWeek,
    );
    if (!week) throw new Error("Fixture current week is missing");
    return week;
  }

  function currentRhythm(): PalAchievement {
    const achievement = currentWeek().achievements.find((candidate) =>
      candidate.id.startsWith(WEEKLY_RHYTHM_ID),
    );
    if (!achievement) throw new Error("Fixture Weekly Rhythm is missing");
    return achievement;
  }

  return {
    async getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    async markRewardSeen(rewardId) {
      snapshot.rewards = snapshot.rewards.filter((reward) => reward.id !== rewardId);
    },
    dispatch(action: PalFixtureAction) {
      if (action === "reset") {
        snapshot = cloneSnapshot(original);
        return "Fixture learner reset";
      }
      if (action === "duplicate-replayed") {
        return "Duplicate replayed — no progress changed";
      }
      if (action === "advance-week") {
        const nextWeek = Math.min(16, snapshot.roadmap.currentWeek + 1);
        snapshot = createFixtureSnapshot(nextWeek);
        return nextWeek === 16 ? "Moved to final semester week" : `Moved to week ${nextWeek}`;
      }
      if (action === "daily-log-completed") {
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
        snapshot.companion.message = "A daily log moved your weekly rhythm forward.";
        return "daily_log.completed applied to fixture state";
      }
      if (action === "on-time-finish") {
        const week = currentWeek();
        if (!week.achievements.some((achievement) => achievement.id === "on-time-finish")) {
          week.achievements.push({
            id: "on-time-finish",
            title: "On-Time Finish",
            description: "Completed a learning item on time.",
            status: "earned",
            statusLabel: "Earned on time",
            badge: { label: "On-Time Finish", icon: "✓" },
            rewardLabel: "Fish snack",
          });
        }
        snapshot.companion.mood = "excited";
        snapshot.companion.moodLabel = "Excited";
        snapshot.companion.message = "An on-time finish made Pip excited.";
        return "learning_item.completed applied to fixture state";
      }

      if (!snapshot.rewards.some((reward) => reward.id === "fixture-fish-reward")) {
        snapshot.rewards.push({
          id: "fixture-fish-reward",
          title: "A treat for Pip!",
          description: "Your on-time work earned a fish snack.",
          icon: "🐟",
        });
      }
      snapshot.companion.mood = "excited";
      snapshot.companion.moodLabel = "Excited";
      return "Fixture reward queued";
    },
    peek() {
      return cloneSnapshot(snapshot);
    },
  };
}
