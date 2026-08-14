import { and, eq, sql } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  learnerFacts,
  rewardNotices,
  weeklyRhythmConfigs,
  type Db,
} from "@pal/db";
import type { IncomingEvent } from "@pal/engine";

export const ACHIEVEMENT_KEYS = {
  firstLogin: "first-pika-login",
  joinedClass: "joined-class",
  weeklyRhythm: "weekly-rhythm",
  readyEarly: "ready-early",
  onTimeFinish: "on-time-finish",
} as const;

type AchievementStatus = "earned" | "in-progress" | "incomplete";

interface FactIdentity {
  semanticKey: string;
  periodKey: string | null;
}

export interface RecordedFact {
  id: string;
  periodKey: string | null;
}

function metadataString(event: IncomingEvent, key: string): string {
  const value = event.metadata[key];
  if (typeof value !== "string") {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value;
}

function metadataInteger(event: IncomingEvent, key: string): number {
  const value = event.metadata[key];
  if (!Number.isInteger(value)) {
    throw new Error(`Validated ${event.event_type} event is missing ${key}`);
  }
  return value as number;
}

function factIdentity(
  event: IncomingEvent,
  idempotencyKey: string,
): FactIdentity {
  switch (event.event_type) {
    case "platform.session.started":
      return { semanticKey: idempotencyKey, periodKey: null };
    case "classroom.joined":
      return {
        semanticKey: metadataString(event, "classroom_token"),
        periodKey: null,
      };
    case "daily_log_week.configured": {
      const periodKey = metadataString(event, "period_key");
      return {
        semanticKey: `${periodKey}:${metadataInteger(event, "config_version")}`,
        periodKey,
      };
    }
    case "daily_log.completed":
      return {
        semanticKey: metadataString(event, "activity_day"),
        periodKey: metadataString(event, "period_key"),
      };
    case "learning_item.viewed":
    case "learning_item.completed":
      return {
        semanticKey: metadataString(event, "item_token"),
        periodKey: metadataString(event, "period_key"),
      };
    default:
      throw new Error(`No semantic identity for ${event.event_type}`);
  }
}

export type WeeklyConfigurationError =
  | "closed_period_revision"
  | "contradictory_period_configuration"
  | "conflicting_period_calendar";

const TERM_CALENDAR_KEYS = [
  "term_token",
  "term_start_day",
  "term_end_day",
  "term_timezone",
  "week_index",
] as const;

function termCalendarMetadata(
  event: IncomingEvent,
): Record<(typeof TERM_CALENDAR_KEYS)[number], string | number> | null {
  if (event.event_type !== "daily_log_week.configured") return null;
  if (event.metadata.week_index === undefined) return null;
  return {
    term_token: metadataString(event, "term_token"),
    term_start_day: metadataString(event, "term_start_day"),
    term_end_day: metadataString(event, "term_end_day"),
    term_timezone: metadataString(event, "term_timezone"),
    week_index: metadataInteger(event, "week_index"),
  };
}

function hasSameTermCalendar(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return TERM_CALENDAR_KEYS.every((key) => left[key] === right[key]);
}

async function completionCount(
  db: Db,
  learnerId: string,
  periodKey: string,
): Promise<number> {
  const [result] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log.completed"),
        eq(learnerFacts.periodKey, periodKey),
      ),
    );
  return result?.value ?? 0;
}

export async function weeklyConfigurationRejection(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<WeeklyConfigurationError | null> {
  if (event.event_type !== "daily_log_week.configured") return null;
  const periodKey = metadataString(event, "period_key");
  const version = metadataInteger(event, "config_version");
  const eligibleDays = metadataInteger(event, "eligible_days");
  const periodStatus = metadataString(event, "period_status");
  const calendar = termCalendarMetadata(event);
  const [existing] = await db
    .select({
      configVersion: weeklyRhythmConfigs.configVersion,
      periodStatus: weeklyRhythmConfigs.periodStatus,
      reconciliationRequired: weeklyRhythmConfigs.reconciliationRequired,
    })
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (
    periodStatus === "closed" &&
    eligibleDays < (await completionCount(db, learnerId, periodKey))
  ) {
    return "contradictory_period_configuration";
  }
  if (
    existing?.periodStatus === "closed" &&
    version > existing.configVersion &&
    (!existing.reconciliationRequired || periodStatus !== "closed")
  ) {
    return "closed_period_revision";
  }
  if (calendar) {
    const [samePeriodCalendar] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          eq(learnerFacts.periodKey, periodKey),
          sql`${learnerFacts.metadata} ? 'week_index'`,
        ),
      )
      .limit(1);
    if (
      samePeriodCalendar &&
      (samePeriodCalendar.metadata as Record<string, unknown>).week_index !== undefined &&
      !hasSameTermCalendar(
        samePeriodCalendar.metadata as Record<string, unknown>,
        calendar,
      )
    ) {
      return "conflicting_period_calendar";
    }

    const [sameTermCalendar] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          sql`${learnerFacts.metadata}->>'term_token' = ${calendar.term_token}`,
        ),
      )
      .limit(1);
    if (
      sameTermCalendar &&
      ((sameTermCalendar.metadata as Record<string, unknown>).term_start_day !==
        calendar.term_start_day ||
        (sameTermCalendar.metadata as Record<string, unknown>).term_end_day !==
          calendar.term_end_day ||
        (sameTermCalendar.metadata as Record<string, unknown>).term_timezone !==
          calendar.term_timezone)
    ) {
      return "conflicting_period_calendar";
    }

    const [occupiedWeek] = await db
      .select({ metadata: learnerFacts.metadata })
      .from(learnerFacts)
      .where(
        and(
          eq(learnerFacts.learnerId, learnerId),
          eq(learnerFacts.eventType, "daily_log_week.configured"),
          sql`${learnerFacts.metadata}->>'term_token' = ${calendar.term_token}`,
          sql`${learnerFacts.metadata}->>'week_index' = ${String(calendar.week_index)}`,
          sql`${learnerFacts.periodKey} <> ${periodKey}`,
        ),
      )
      .limit(1);
    if (occupiedWeek) return "conflicting_period_calendar";
  }
  return null;
}

function authoritativePeriodAnchor(event: IncomingEvent): Date {
  if (event.event_type === "daily_log.completed") {
    return new Date(`${metadataString(event, "activity_day")}T00:00:00.000Z`);
  }
  return new Date(event.occurred_at);
}

async function ensurePeriod(
  db: Db,
  learnerId: string,
  periodKey: string | null,
  event: IncomingEvent,
): Promise<void> {
  if (!periodKey) return;
  const anchorAt = authoritativePeriodAnchor(event);
  const [existing] = await db
    .select({ id: achievementPeriods.id, anchorAt: achievementPeriods.anchorAt })
    .from(achievementPeriods)
    .where(
      and(
        eq(achievementPeriods.learnerId, learnerId),
        eq(achievementPeriods.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (anchorAt.getTime() < existing.anchorAt.getTime()) {
      await db
        .update(achievementPeriods)
        .set({ anchorAt })
        .where(eq(achievementPeriods.id, existing.id));
    }
    return;
  }

  await db.insert(achievementPeriods).values({
    learnerId,
    periodKey,
    anchorAt,
  });
}

export async function recordSemanticFact(
  db: Db,
  input: {
    integrationId: string;
    learnerId: string;
    sourceEventId: string;
    event: IncomingEvent;
    idempotencyKey: string;
  },
): Promise<RecordedFact | null> {
  const identity = factIdentity(input.event, input.idempotencyKey);
  const [fact] = await db
    .insert(learnerFacts)
    .values({
      integrationId: input.integrationId,
      learnerId: input.learnerId,
      sourceEventId: input.sourceEventId,
      eventType: input.event.event_type,
      semanticKey: identity.semanticKey,
      periodKey: identity.periodKey,
      occurredAt: new Date(input.event.occurred_at),
      metadata: input.event.metadata,
    })
    .onConflictDoNothing()
    .returning({ id: learnerFacts.id });
  if (!fact) return null;
  await ensurePeriod(db, input.learnerId, identity.periodKey, input.event);
  return { id: fact.id, periodKey: identity.periodKey };
}

export async function semanticFactAlreadyRecorded(
  db: Db,
  input: {
    learnerId: string;
    event: IncomingEvent;
    idempotencyKey: string;
  },
): Promise<boolean> {
  const identity = factIdentity(input.event, input.idempotencyKey);
  const [existing] = await db
    .select({ id: learnerFacts.id })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, input.learnerId),
        eq(learnerFacts.eventType, input.event.event_type),
        eq(learnerFacts.semanticKey, identity.semanticKey),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function createScopedOutcome(
  db: Db,
  input: {
    learnerId: string;
    achievementKey: string;
    scopeKey: string;
    periodKey: string | null;
    status: AchievementStatus;
    factId: string;
    occurredAt: Date;
  },
): Promise<{ id: string; created: boolean }> {
  const [created] = await db
    .insert(achievementInstances)
    .values({
      learnerId: input.learnerId,
      achievementKey: input.achievementKey,
      scopeKey: input.scopeKey,
      periodKey: input.periodKey,
      status: input.status,
      earnedAt: input.status === "earned" ? input.occurredAt : null,
      sourceFactId: input.factId,
    })
    .onConflictDoNothing()
    .returning({ id: achievementInstances.id });
  if (created) return { id: created.id, created: true };

  const [existing] = await db
    .select({ id: achievementInstances.id })
    .from(achievementInstances)
    .where(
      and(
        eq(achievementInstances.learnerId, input.learnerId),
        eq(achievementInstances.achievementKey, input.achievementKey),
        eq(achievementInstances.scopeKey, input.scopeKey),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Failed to resolve achievement instance");
  return { id: existing.id, created: false };
}

function weeklyTarget(eligibleDays: number): number {
  if (eligibleDays <= 2) return eligibleDays;
  return eligibleDays - 1;
}

async function recomputeWeeklyRhythm(
  db: Db,
  learnerId: string,
  periodKey: string,
  factId: string,
  occurredAt: Date,
): Promise<void> {
  const [configuration] = await db
    .select()
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (!configuration) return;

  const current = await completionCount(db, learnerId, periodKey);
  const targetDays = weeklyTarget(configuration.eligibleDays);
  const reconciliationRequired = current > configuration.eligibleDays;
  if (configuration.reconciliationRequired !== reconciliationRequired) {
    await db
      .update(weeklyRhythmConfigs)
      .set({ reconciliationRequired, updatedAt: new Date() })
      .where(eq(weeklyRhythmConfigs.id, configuration.id));
  }

  const [existing] = await db
    .select()
    .from(achievementInstances)
    .where(
      and(
        eq(achievementInstances.learnerId, learnerId),
        eq(achievementInstances.achievementKey, ACHIEVEMENT_KEYS.weeklyRhythm),
        eq(achievementInstances.scopeKey, periodKey),
      ),
    )
    .limit(1);

  if (targetDays === 0 && !reconciliationRequired) {
    if (existing && existing.status !== "earned") {
      await db
        .delete(achievementInstances)
        .where(eq(achievementInstances.id, existing.id));
    }
    return;
  }

  // An award is historical. Open-period revisions may recompute only an
  // unawarded target; they never revoke or visually weaken an earned instance.
  if (existing?.status === "earned") return;

  const earned =
    !reconciliationRequired && current >= targetDays;
  const status: AchievementStatus =
    reconciliationRequired
      ? "in-progress"
      : earned
      ? "earned"
      : configuration.periodStatus === "closed"
        ? "incomplete"
        : "in-progress";
  const displayTarget = reconciliationRequired
    ? Math.max(targetDays, current + 1)
    : targetDays;

  if (existing) {
    await db
      .update(achievementInstances)
      .set({
        status,
        progressCurrent: current,
        progressTarget: displayTarget,
        earnedAt:
          existing.earnedAt ?? (status === "earned" ? occurredAt : null),
        sourceFactId: factId,
        updatedAt: new Date(),
      })
      .where(eq(achievementInstances.id, existing.id));
    return;
  }

  await db.insert(achievementInstances).values({
    learnerId,
    achievementKey: ACHIEVEMENT_KEYS.weeklyRhythm,
    scopeKey: periodKey,
    periodKey,
    status,
    progressCurrent: current,
    progressTarget: displayTarget,
    earnedAt: status === "earned" ? occurredAt : null,
    sourceFactId: factId,
  });
}

async function applyWeeklyConfiguration(
  db: Db,
  learnerId: string,
  fact: RecordedFact,
  event: IncomingEvent,
): Promise<void> {
  const periodKey = metadataString(event, "period_key");
  const version = metadataInteger(event, "config_version");
  const eligibleDays = metadataInteger(event, "eligible_days");
  const periodStatus = metadataString(event, "period_status");
  const [existing] = await db
    .select()
    .from(weeklyRhythmConfigs)
    .where(
      and(
        eq(weeklyRhythmConfigs.learnerId, learnerId),
        eq(weeklyRhythmConfigs.periodKey, periodKey),
      ),
    )
    .limit(1);

  if (!existing) {
    await db.insert(weeklyRhythmConfigs).values({
      learnerId,
      periodKey,
      configVersion: version,
      periodStatus,
      eligibleDays,
      configuredAt: new Date(event.occurred_at),
    });
  } else if (version > existing.configVersion) {
    await db
      .update(weeklyRhythmConfigs)
      .set({
        configVersion: version,
        periodStatus,
        eligibleDays,
        configuredAt: new Date(event.occurred_at),
        updatedAt: new Date(),
      })
      .where(eq(weeklyRhythmConfigs.id, existing.id));
  }

  await recomputeWeeklyRhythm(
    db,
    learnerId,
    periodKey,
    fact.id,
    new Date(event.occurred_at),
  );
}

export async function applyAchievementFact(
  db: Db,
  learnerId: string,
  fact: RecordedFact,
  event: IncomingEvent,
): Promise<void> {
  const occurredAt = new Date(event.occurred_at);
  switch (event.event_type) {
    case "platform.session.started":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.firstLogin,
        scopeKey: "lifetime",
        periodKey: null,
        status: "earned",
        factId: fact.id,
        occurredAt,
      });
      return;
    case "classroom.joined":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.joinedClass,
        scopeKey: metadataString(event, "classroom_token"),
        periodKey: null,
        status: "earned",
        factId: fact.id,
        occurredAt,
      });
      return;
    case "daily_log_week.configured":
      await applyWeeklyConfiguration(db, learnerId, fact, event);
      return;
    case "daily_log.completed":
      await recomputeWeeklyRhythm(
        db,
        learnerId,
        metadataString(event, "period_key"),
        fact.id,
        occurredAt,
      );
      return;
    case "learning_item.viewed":
      await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.readyEarly,
        scopeKey: metadataString(event, "item_token"),
        periodKey: fact.periodKey,
        status:
          metadataString(event, "timing") === "within_24h_of_release"
            ? "earned"
            : "incomplete",
        factId: fact.id,
        occurredAt,
      });
      return;
    case "learning_item.completed": {
      const earned = metadataString(event, "timing") === "on_time";
      const outcome = await createScopedOutcome(db, {
        learnerId,
        achievementKey: ACHIEVEMENT_KEYS.onTimeFinish,
        scopeKey: metadataString(event, "item_token"),
        periodKey: fact.periodKey,
        status: earned ? "earned" : "incomplete",
        factId: fact.id,
        occurredAt,
      });
      if (earned && outcome.created) {
        await db
          .insert(rewardNotices)
          .values({
            learnerId,
            achievementInstanceId: outcome.id,
            rewardKey: "fish-snack-v1",
            title: "A treat for Pip!",
            description: "Your on-time work earned a fish snack.",
            icon: "🐟",
          })
          .onConflictDoNothing();
      }
      return;
    }
  }
}
