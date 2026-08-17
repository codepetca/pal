import {
  and,
  asc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  economy,
  getDb,
  learnerFacts,
  learnerRewardGrants,
  learners,
  petState,
  rewardNotices,
  worldState,
  weeklyRhythmConfigs,
  type Db,
} from "@pal/db";
import type {
  PalAchievement,
  PalAchievementCelebrationNotice,
  PalCollectionItem,
  PalCompanionMood,
  PalRoadmapWeek,
  PalWidgetSnapshot,
} from "@codepet/pal-widget";
import { resolvePalAchievementPresentation } from "@codepet/pal-widget/achievement-presentation";
import { PROGRESSION_POLICY } from "@pal/engine";
import {
  ACHIEVEMENT_KEYS,
  ACHIEVEMENT_NOTICE_KEY,
} from "@/lib/achievement-state";
import {
  loadPersistedStoryPlan,
  loadPersistedStoryPlansByIds,
} from "@/lib/story-plan";
import {
  projectStoryProgression,
  projectUnseenGrantRewards,
} from "@/lib/story-projector";

const LEGACY_SEMESTER_WEEKS = 16;

const COLLECTION_ITEMS = new Map<string, PalCollectionItem>(
  PROGRESSION_POLICY.collectionMilestones.map((milestone) => [
    milestone.assetRefId,
    {
      id: milestone.assetRefId,
      label: milestone.label,
      description: milestone.description,
      icon: milestone.icon,
    },
  ]),
);

function collectionItemsForUnlocks(unlockedObjectIds: readonly string[]) {
  return unlockedObjectIds.flatMap((id) => {
    const item = COLLECTION_ITEMS.get(id);
    return item ? [{ ...item }] : [];
  });
}

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

function moodMessage(mood: PalCompanionMood, companionRevealed = true): string {
  const subject = companionRevealed ? "Pip" : "Your companion";
  switch (mood) {
    case "happy":
      return `${subject} is happy about your progress.`;
    case "excited":
      return `${subject} is excited!`;
    case "sleeping":
      return `${subject} is taking a rest.`;
    default:
      return companionRevealed
        ? "Complete positive learning actions to encourage Pip."
        : "Complete positive learning actions to encourage your companion.";
  }
}

type AchievementRow = typeof achievementInstances.$inferSelect;

type CalendarFact = {
  periodKey: string | null;
  occurredAt: Date;
  metadata: unknown;
};

function selectCurrentTermFact(
  calendarFacts: CalendarFact[],
  asOf: Date,
): CalendarFact | undefined {
  const terms = new Map<string, CalendarFact>();
  for (const fact of calendarFacts) {
    const metadata = fact.metadata as Record<string, unknown>;
    if (
      typeof metadata.term_token === "string" &&
      typeof metadata.term_start_day === "string" &&
      typeof metadata.term_end_day === "string" &&
      typeof metadata.term_timezone === "string"
    ) {
      terms.set(metadata.term_token, fact);
    }
  }
  const candidates = [...terms.values()];
  const dates = (fact: CalendarFact) => {
    const metadata = fact.metadata as Record<string, unknown>;
    return {
      start: String(metadata.term_start_day),
      end: String(metadata.term_end_day),
      asOfDay: calendarDayInTimeZone(asOf, String(metadata.term_timezone)),
    };
  };
  const active = candidates
    .filter((fact) => {
      const { start, end } = dates(fact);
      const { asOfDay } = dates(fact);
      return start <= asOfDay && asOfDay <= end;
    })
    .toSorted((left, right) => dates(right).start.localeCompare(dates(left).start));
  if (active[0]) return active[0];

  const completed = candidates
    .filter((fact) => {
      const { end, asOfDay } = dates(fact);
      return end < asOfDay;
    })
    .toSorted((left, right) => dates(right).end.localeCompare(dates(left).end));
  if (completed[0]) return completed[0];

  return candidates
    .filter((fact) => {
      const { start, asOfDay } = dates(fact);
      return start > asOfDay;
    })
    .toSorted((left, right) => dates(left).start.localeCompare(dates(right).start))[0];
}

function calendarDayInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function nextCalendarDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function achievementFromRow(
  row: AchievementRow,
  reconciliationRequired: boolean,
): PalAchievement | null {
  const presentation = resolvePalAchievementPresentation(row.achievementKey);
  if (!presentation) return null;
  const common = {
    id: row.id,
    ...presentation,
    status: row.status as PalAchievement["status"],
  };
  switch (row.achievementKey) {
    case ACHIEVEMENT_KEYS.firstLogin:
      return {
        ...common,
        statusLabel: "Earned",
      };
    case ACHIEVEMENT_KEYS.joinedClass:
      return {
        ...common,
        statusLabel: "Earned",
      };
    case ACHIEVEMENT_KEYS.weeklyRhythm: {
      const current = row.progressCurrent ?? 0;
      const target = row.progressTarget ?? 1;
      const progressLabel = reconciliationRequired
        ? "Waiting for a schedule update"
        : `${current} of ${target} eligible days`;
      return {
        ...common,
        statusLabel:
          row.status === "earned"
            ? "Earned"
            : row.status === "incomplete"
              ? "Not completed"
              : progressLabel,
        progress: { current, target, label: progressLabel },
        ...(row.status === "earned"
          ? { rewardLabel: "Happy companion" }
          : {}),
      };
    }
    case ACHIEVEMENT_KEYS.readyEarly:
      return {
        ...common,
        statusLabel: row.status === "earned" ? "Earned early" : "Opened later",
      };
    case ACHIEVEMENT_KEYS.onTimeFinish:
      return {
        ...common,
        statusLabel: row.status === "earned" ? "Earned on time" : "Completed late",
      };
    default:
      return null;
  }
}

function achievementCelebration(
  row: {
    id: string;
    achievementInstanceId: string;
    achievementKey: string;
  },
): PalAchievementCelebrationNotice | null {
  const presentation = resolvePalAchievementPresentation(row.achievementKey);
  return presentation
    ? {
        id: row.id,
        kind: "achievement",
        achievement: {
          id: row.achievementInstanceId,
          ...presentation,
        },
      }
    : null;
}

export async function loadLearnerSnapshot(
  integrationId: string,
  learnerId: string,
  db: Db = getDb(),
  options: {
    // Internal coordination seam used to prove transaction isolation under a
    // deterministic concurrent write. Production callers leave this unset.
    afterScopeVerified?: () => Promise<void>;
    asOf?: Date;
  } = {},
): Promise<PalWidgetSnapshot> {
  return db.transaction(
    async (tx) => {
      const [learner] = await tx
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
      await options.afterScopeVerified?.();

      const economyRows = await tx
        .select()
        .from(economy)
        .where(eq(economy.learnerId, learnerId))
        .limit(1);
      const petRows = await tx
        .select()
        .from(petState)
        .where(eq(petState.learnerId, learnerId))
        .limit(1);
      const worldRows = await tx
        .select()
        .from(worldState)
        .where(eq(worldState.learnerId, learnerId))
        .limit(1);
      const configurations = await tx
        .select()
        .from(weeklyRhythmConfigs)
        .where(eq(weeklyRhythmConfigs.learnerId, learnerId));
      const calendarFacts = await tx
        .select({
          periodKey: learnerFacts.periodKey,
          occurredAt: learnerFacts.occurredAt,
          metadata: learnerFacts.metadata,
        })
        .from(learnerFacts)
        .where(
          and(
            eq(learnerFacts.learnerId, learnerId),
            eq(learnerFacts.eventType, "daily_log_week.configured"),
            sql`${learnerFacts.metadata} ? 'term_token'`,
          ),
        )
        .orderBy(asc(learnerFacts.occurredAt));
      const achievementRewards = await tx
        .select({
          id: rewardNotices.id,
          achievementInstanceId: achievementInstances.id,
          achievementKey: achievementInstances.achievementKey,
        })
        .from(rewardNotices)
        .innerJoin(
          achievementInstances,
          and(
            eq(
              achievementInstances.id,
              rewardNotices.achievementInstanceId,
            ),
            eq(achievementInstances.learnerId, rewardNotices.learnerId),
          ),
        )
        .where(
          and(
            eq(rewardNotices.learnerId, learnerId),
            isNull(rewardNotices.seenAt),
            eq(rewardNotices.rewardKey, ACHIEVEMENT_NOTICE_KEY),
            eq(achievementInstances.status, "earned"),
          ),
        )
        .orderBy(asc(rewardNotices.createdAt))
        .limit(100);
      const grantRows = await tx
        .select()
        .from(learnerRewardGrants)
        .where(eq(learnerRewardGrants.learnerId, learnerId))
        .orderBy(asc(learnerRewardGrants.grantOrder));

      const latestCalendarFact = selectCurrentTermFact(
        calendarFacts,
        options.asOf ?? new Date(),
      );
      const currentTermMetadata = latestCalendarFact?.metadata as
        | Record<string, unknown>
        | undefined;
      const currentTermToken = currentTermMetadata?.term_token;
      const termStartDay = currentTermMetadata?.term_start_day;
      const termEndDay = currentTermMetadata?.term_end_day;
      const termTimezone = currentTermMetadata?.term_timezone;
      const termWeekCount =
        Number.isInteger(currentTermMetadata?.term_week_count) &&
        (currentTermMetadata?.term_week_count as number) >= 6 &&
        (currentTermMetadata?.term_week_count as number) <= 24
          ? (currentTermMetadata?.term_week_count as number)
          : LEGACY_SEMESTER_WEEKS;
      const persistedStoryPlan = typeof currentTermToken === "string"
        ? await loadPersistedStoryPlan(tx, learnerId, currentTermToken)
        : undefined;
      const historicalStoryPlans = await loadPersistedStoryPlansByIds(
        tx,
        learnerId,
        grantRows.flatMap((grant) =>
          grant.kind === "story_chapter" &&
          grant.storyPlanId &&
          grant.storyPlanId !== persistedStoryPlan?.id
            ? [grant.storyPlanId]
            : [],
        ),
      );
      const storyPlansById = new Map(historicalStoryPlans);
      if (persistedStoryPlan) {
        storyPlansById.set(persistedStoryPlan.id, persistedStoryPlan);
      }
      const progression = persistedStoryPlan
        ? projectStoryProgression(persistedStoryPlan, grantRows, storyPlansById)
        : undefined;
      const authoritativeWeekNumbers = new Map<string, number>();
      const authoritativeWeekStarts = new Map<string, string>();
      for (const fact of calendarFacts) {
        const metadata = fact.metadata as Record<string, unknown>;
        const weekIndex = metadata.week_index;
        const weekStartDay = metadata.week_start_day;
        if (
          fact.periodKey &&
          typeof currentTermToken === "string" &&
          metadata.term_token === currentTermToken &&
          Number.isInteger(weekIndex) &&
          (weekIndex as number) >= 1 &&
          (weekIndex as number) <= termWeekCount
        ) {
          authoritativeWeekNumbers.set(fact.periodKey, weekIndex as number);
          if (typeof weekStartDay === "string") {
            authoritativeWeekStarts.set(fact.periodKey, weekStartDay);
          }
        }
      }
      const authoritativePeriodKeys = [...authoritativeWeekNumbers.keys()];
      const allCalendarPeriodKeys = [
        ...new Set(
          calendarFacts.flatMap((fact) =>
            fact.periodKey ? [fact.periodKey] : [],
          ),
        ),
      ];
      const authoritativePeriods = authoritativePeriodKeys.length
        ? await tx
            .select()
            .from(achievementPeriods)
            .where(
              and(
                eq(achievementPeriods.learnerId, learnerId),
                inArray(achievementPeriods.periodKey, authoritativePeriodKeys),
              ),
            )
        : [];
      const legacyPlacementDay = sql<string>`coalesce(
        (
          select min("legacy_activity_facts"."metadata"->>'activity_day')
          from "learner_facts" as "legacy_activity_facts"
          where "legacy_activity_facts"."learner_id" = "achievement_periods"."learner_id"
            and "legacy_activity_facts"."period_key" = "achievement_periods"."period_key"
            and "legacy_activity_facts"."event_type" = 'daily_log.completed'
        ),
        to_char(
          "achievement_periods"."anchor_at" at time zone ${typeof termTimezone === "string" ? termTimezone : "UTC"},
          'YYYY-MM-DD'
        )
      )`;
      const legacyPeriods = await tx
        .select({
          ...getTableColumns(achievementPeriods),
          placementDay: legacyPlacementDay,
        })
        .from(achievementPeriods)
        .where(
          and(
            eq(achievementPeriods.learnerId, learnerId),
            ...(typeof termStartDay === "string" &&
            typeof termEndDay === "string"
              ? [
                  gte(legacyPlacementDay, termStartDay),
                  lt(legacyPlacementDay, nextCalendarDay(termEndDay)),
                ]
              : []),
            ...(allCalendarPeriodKeys.length > 0
              ? [
                  notInArray(
                    achievementPeriods.periodKey,
                    allCalendarPeriodKeys,
                  ),
                ]
              : []),
          ),
        )
        .orderBy(
          typeof termStartDay === "string"
            ? asc(legacyPlacementDay)
            : asc(achievementPeriods.anchorAt),
          asc(achievementPeriods.createdAt),
        )
        .limit(termWeekCount);
      const legacyPlacementDays = new Map(
        legacyPeriods.map((period) => [period.periodKey, period.placementDay]),
      );
      const periods = [
        ...new Map(
          [...authoritativePeriods, ...legacyPeriods].map((period) => [
            period.periodKey,
            period,
          ]),
        ).values(),
      ];
      const instances = await tx
        .select()
        .from(achievementInstances)
        .where(eq(achievementInstances.learnerId, learnerId))
        .orderBy(asc(achievementInstances.createdAt));
      const periodNumbers = new Map<string, number>();
      for (const period of periods) {
        const authoritativeWeek = authoritativeWeekNumbers.get(period.periodKey);
        if (authoritativeWeek) {
          periodNumbers.set(period.periodKey, authoritativeWeek);
          continue;
        }
        const placementDay = legacyPlacementDays.get(period.periodKey);
        if (typeof termStartDay === "string" && placementDay) {
          const derivedWeek =
            Math.floor(
              (Date.parse(`${placementDay}T00:00:00.000Z`) -
                Date.parse(`${termStartDay}T00:00:00.000Z`)) /
                (7 * 86_400_000),
            ) + 1;
          if (derivedWeek >= 1 && derivedWeek <= termWeekCount) {
            periodNumbers.set(period.periodKey, derivedWeek);
          }
          continue;
        }
        periodNumbers.set(period.periodKey, periodNumbers.size + 1);
      }
      const reconciliation = new Map(
        configurations.map((configuration) => [
          configuration.periodKey,
          configuration.reconciliationRequired,
        ]),
      );
      const asOf = options.asOf ?? new Date();
      const asOfDay =
        typeof termTimezone === "string"
          ? calendarDayInTimeZone(asOf, termTimezone)
          : null;
      const startedWeekNumbers = [...periodNumbers.entries()].flatMap(
        ([periodKey, weekNumber]) => {
          const authoritativeStart = authoritativeWeekStarts.get(periodKey);
          if (authoritativeStart) {
            return asOfDay !== null && authoritativeStart <= asOfDay
              ? [weekNumber]
              : [];
          }
          if (authoritativeWeekNumbers.has(periodKey)) {
            return (
              asOfDay === null ||
              typeof termStartDay !== "string" ||
              termStartDay <= asOfDay
            )
              ? [weekNumber]
              : [];
          }
          const legacyStart = legacyPlacementDays.get(periodKey);
          return asOfDay === null || (legacyStart && legacyStart <= asOfDay)
            ? [weekNumber]
            : [];
        },
      );
      // Snapshot schema v1 has always required a supplied week number >= 1.
      // Preserve that wire contract before a term opens; week statuses carry
      // the not-started state for pinned widget clients.
      const currentWeek = startedWeekNumbers.length === 0
        ? 1
        : Math.min(termWeekCount, Math.max(...startedWeekNumbers));
      const weeks: PalRoadmapWeek[] = Array.from(
        { length: termWeekCount },
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
        if (!weekNumber || weekNumber > termWeekCount) continue;
        const achievement = achievementFromRow(
          instance,
          instance.periodKey
            ? (reconciliation.get(instance.periodKey) ?? false)
            : false,
        );
        if (achievement) {
          weeks[weekNumber - 1].achievements.push(achievement);
        }
      }
      for (const week of weeks) {
        week.achievements = week.achievements.slice(0, 100);
      }

      const eco = economyRows[0];
      const pet = petRows[0];
      const mood = companionMood(
        pet?.mood ?? "neutral",
        pet?.moodExpiresAt ?? null,
      );
      const companionRevealed =
        progression === undefined || progression.companionReveal.status === "earned";
      const companion = {
        name: companionRevealed ? "Pip" : "Mystery companion",
        mood,
        moodLabel: mood[0].toUpperCase() + mood.slice(1),
        level: eco?.level ?? 1,
        streak: eco?.streakCurrent ?? 0,
        xp: eco?.xp ?? 0,
        xpToNextLevel: Math.max(
          0,
          PROGRESSION_POLICY.levelUpCostXp - (eco?.xp ?? 0),
        ),
        message: moodMessage(mood, companionRevealed),
        ...(persistedStoryPlan
          ? {}
          : { assetUrl: "/assets/pets/default.png" }),
      };
      return {
        schemaVersion: 1,
        roadmap: {
          semesterLabel: "Achievement semester",
          currentWeek,
          weeks,
        },
        companion,
        collection: {
          items: collectionItemsForUnlocks(
            worldRows[0]?.unlockedObjectIds ?? [],
          ),
        },
        rewards: [
          ...projectUnseenGrantRewards(grantRows, storyPlansById),
          ...achievementRewards.flatMap((reward) => {
            const projected = achievementCelebration(reward);
            return projected ? [projected] : [];
          }),
        ].slice(0, 100),
        ...(progression ? { progression } : {}),
      };
    },
    {
      accessMode: "read only",
      isolationLevel: "repeatable read",
    },
  );
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

  const seenAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(rewardNotices)
      .set({ seenAt })
      .where(and(
        eq(rewardNotices.id, rewardId),
        eq(rewardNotices.learnerId, learnerId),
        isNull(rewardNotices.seenAt),
      ));
    await tx
      .update(learnerRewardGrants)
      .set({ seenAt })
      .where(and(
        eq(learnerRewardGrants.id, rewardId),
        eq(learnerRewardGrants.learnerId, learnerId),
        isNull(learnerRewardGrants.seenAt),
      ));
  });
}
