import { and, asc, eq, isNull } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  economy,
  getDb,
  learners,
  petState,
  rewardNotices,
  weeklyRhythmConfigs,
  type Db,
} from "@pal/db";
import type {
  PalAchievement,
  PalCompanionMood,
  PalRoadmapWeek,
  PalWidgetSnapshot,
} from "@codepet/pal-widget";
import { ACHIEVEMENT_KEYS } from "@/lib/achievement-state";

const SEMESTER_WEEKS = 16;
const LEVEL_UP_COST_XP = 500;

export class LearnerScopeError extends Error {
  constructor() {
    super("Learner token scope does not match persisted state");
    this.name = "LearnerScopeError";
  }
}

function companionMood(value: string, expiresAt: Date | null): PalCompanionMood {
  if (expiresAt && expiresAt.getTime() <= Date.now()) return "neutral";
  return ["neutral", "happy", "excited", "sleeping"].includes(value)
    ? (value as PalCompanionMood)
    : "neutral";
}

function moodMessage(mood: PalCompanionMood): string {
  switch (mood) {
    case "happy":
      return "Pip is happy about your progress.";
    case "excited":
      return "Pip is excited!";
    case "sleeping":
      return "Pip is taking a rest.";
    default:
      return "Complete positive learning actions to encourage Pip.";
  }
}

type AchievementRow = typeof achievementInstances.$inferSelect;

function achievementFromRow(
  row: AchievementRow,
  reconciliationRequired: boolean,
): PalAchievement | null {
  const common = {
    id: row.id,
    status: row.status as PalAchievement["status"],
  };
  switch (row.achievementKey) {
    case ACHIEVEMENT_KEYS.firstLogin:
      return {
        ...common,
        title: "First Pika Login",
        description: "Started your first authenticated Pika session.",
        statusLabel: "Earned",
        badge: { label: "First Pika Login", icon: "★" },
      };
    case ACHIEVEMENT_KEYS.joinedClass:
      return {
        ...common,
        title: "Joined the Class",
        description: "Joined a new classroom.",
        statusLabel: "Earned",
        badge: { label: "Joined the Class", icon: "⌂" },
      };
    case ACHIEVEMENT_KEYS.weeklyRhythm: {
      const current = row.progressCurrent ?? 0;
      const target = row.progressTarget ?? 1;
      const progressLabel = reconciliationRequired
        ? "Waiting for a schedule update"
        : `${current} of ${target} eligible days`;
      return {
        ...common,
        title: "Weekly Rhythm",
        description: "Complete daily logs on the target number of eligible days.",
        statusLabel:
          row.status === "earned"
            ? "Earned"
            : row.status === "incomplete"
              ? "Not completed"
              : progressLabel,
        badge: { label: "Weekly Rhythm", icon: "♫" },
        progress: { current, target, label: progressLabel },
        ...(row.status === "earned"
          ? { rewardLabel: "Happy companion" }
          : {}),
      };
    }
    case ACHIEVEMENT_KEYS.readyEarly:
      return {
        ...common,
        title: "Ready Early",
        description: "Opened a learning item soon after it was released.",
        statusLabel: row.status === "earned" ? "Earned early" : "Opened later",
        badge: { label: "Ready Early", icon: "◷" },
      };
    case ACHIEVEMENT_KEYS.onTimeFinish:
      return {
        ...common,
        title: "On-Time Finish",
        description: "Completed a learning item by its deadline.",
        statusLabel: row.status === "earned" ? "Earned on time" : "Completed late",
        badge: {
          label: "On-Time Finish",
          assetUrl: "/assets/badges/badge-on-time-finish.png",
        },
        ...(row.status === "earned" ? { rewardLabel: "Fish snack" } : {}),
      };
    default:
      return null;
  }
}

export async function loadLearnerSnapshot(
  integrationId: string,
  learnerId: string,
  db: Db = getDb(),
): Promise<PalWidgetSnapshot> {
  const [learner] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      and(
        eq(learners.id, learnerId),
        eq(learners.integrationId, integrationId),
      ),
    )
    .limit(1);
  if (!learner) throw new LearnerScopeError();

  const [economyRows, petRows, periods, instances, configurations, rewards] =
    await Promise.all([
      db.select().from(economy).where(eq(economy.learnerId, learnerId)).limit(1),
      db.select().from(petState).where(eq(petState.learnerId, learnerId)).limit(1),
      db
        .select()
        .from(achievementPeriods)
        .where(eq(achievementPeriods.learnerId, learnerId))
        .orderBy(asc(achievementPeriods.ordinal))
        .limit(SEMESTER_WEEKS),
      db
        .select()
        .from(achievementInstances)
        .where(eq(achievementInstances.learnerId, learnerId))
        .orderBy(asc(achievementInstances.createdAt)),
      db
        .select()
        .from(weeklyRhythmConfigs)
        .where(eq(weeklyRhythmConfigs.learnerId, learnerId)),
      db
        .select()
        .from(rewardNotices)
        .where(
          and(
            eq(rewardNotices.learnerId, learnerId),
            isNull(rewardNotices.seenAt),
          ),
        )
        .orderBy(asc(rewardNotices.createdAt)),
    ]);

  const periodNumbers = new Map(
    periods.map((period) => [period.periodKey, period.ordinal]),
  );
  const reconciliation = new Map(
    configurations.map((configuration) => [
      configuration.periodKey,
      configuration.reconciliationRequired,
    ]),
  );
  const currentWeek = Math.max(
    1,
    Math.min(SEMESTER_WEEKS, periods.at(-1)?.ordinal ?? 1),
  );
  const weeks: PalRoadmapWeek[] = Array.from(
    { length: SEMESTER_WEEKS },
    (_, index) => {
      const number = index + 1;
      const status =
        number < currentWeek
          ? "past"
          : number === currentWeek
            ? "current"
            : "future";
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
    },
  );

  for (const instance of instances) {
    const weekNumber = instance.periodKey
      ? periodNumbers.get(instance.periodKey)
      : 1;
    if (!weekNumber || weekNumber > SEMESTER_WEEKS) continue;
    const achievement = achievementFromRow(
      instance,
      instance.periodKey
        ? (reconciliation.get(instance.periodKey) ?? false)
        : false,
    );
    if (achievement) weeks[weekNumber - 1].achievements.push(achievement);
  }

  const eco = economyRows[0];
  const pet = petRows[0];
  const mood = companionMood(pet?.mood ?? "neutral", pet?.moodExpiresAt ?? null);
  return {
    schemaVersion: 1,
    roadmap: {
      semesterLabel: "Achievement semester",
      currentWeek,
      weeks,
    },
    companion: {
      name: "Pip",
      mood,
      moodLabel: mood[0].toUpperCase() + mood.slice(1),
      level: eco?.level ?? 1,
      streak: eco?.streakCurrent ?? 0,
      xp: eco?.xp ?? 0,
      xpToNextLevel: Math.max(0, LEVEL_UP_COST_XP - (eco?.xp ?? 0)),
      message: moodMessage(mood),
      assetUrl: "/assets/pets/default.png",
    },
    rewards: rewards.map((reward) => ({
      id: reward.id,
      title: reward.title,
      description: reward.description,
      ...(reward.icon ? { icon: reward.icon } : {}),
    })),
  };
}

export async function acknowledgeLearnerReward(
  integrationId: string,
  learnerId: string,
  rewardId: string,
  db: Db = getDb(),
): Promise<void> {
  const [learner] = await db
    .select({ id: learners.id })
    .from(learners)
    .where(
      and(
        eq(learners.id, learnerId),
        eq(learners.integrationId, integrationId),
      ),
    )
    .limit(1);
  if (!learner) throw new LearnerScopeError();

  await db
    .update(rewardNotices)
    .set({ seenAt: new Date() })
    .where(
      and(
        eq(rewardNotices.id, rewardId),
        eq(rewardNotices.learnerId, learnerId),
        isNull(rewardNotices.seenAt),
      ),
    );
}
