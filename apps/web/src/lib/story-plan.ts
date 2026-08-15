import { and, asc, eq, sql } from "drizzle-orm";
import {
  learnerFacts,
  rewardNotices,
  storyPlanChapters,
  storyPlans,
  type Db,
} from "@pal/db";
import type { IncomingEvent } from "@pal/engine";
import {
  createPalStoryPlan,
  DEFAULT_PAL_STORY,
  getPalStoryCatalog,
  getPalStoryChapterDefinition,
  PIP_STORY_ID,
  PIP_STORY_VERSION,
  type PalStoryPlan,
  type PalStoryReference,
} from "@codepet/pal-widget/progression";
import { awardLearnerTitle } from "@/lib/title-awards";

const STORY_REWARD_PREFIX = "story:";
const LEGACY_STORY_REWARD_REFERENCE: PalStoryReference = {
  storyId: PIP_STORY_ID,
  version: PIP_STORY_VERSION,
};
const LEGACY_TERM_PERIODS = 16;

type TermPeriod = {
  termKey: string;
  totalPeriods: number;
  periodKey: string;
  periodNumber: number;
};

function storyReference(
  storyId: string,
  storyVersion: number,
): PalStoryReference {
  return { storyId, version: storyVersion };
}

function storyRewardKey(
  reference: PalStoryReference,
  chapterId: string,
): string {
  return `${STORY_REWARD_PREFIX}${reference.storyId}@${reference.version}:${chapterId}`;
}

export function storyRewardKeysForChapter(
  reference: PalStoryReference,
  chapterId: string,
): readonly string[] {
  const versioned = storyRewardKey(reference, chapterId);
  return reference.storyId === LEGACY_STORY_REWARD_REFERENCE.storyId &&
      reference.version === LEGACY_STORY_REWARD_REFERENCE.version
    ? [versioned, `${STORY_REWARD_PREFIX}${chapterId}`]
    : [versioned];
}

function parseStoryRewardKey(rewardKey: string): {
  reference: PalStoryReference;
  chapterId: string;
} | undefined {
  if (!rewardKey.startsWith(STORY_REWARD_PREFIX)) return undefined;
  const payload = rewardKey.slice(STORY_REWARD_PREFIX.length);
  const separator = payload.indexOf(":");
  if (separator === -1) {
    // Compatibility for notices created before story references were encoded.
    // This must remain pinned to Pip v1 even when the default story advances.
    return { reference: LEGACY_STORY_REWARD_REFERENCE, chapterId: payload };
  }
  const catalogKey = payload.slice(0, separator);
  const chapterId = payload.slice(separator + 1);
  const versionSeparator = catalogKey.lastIndexOf("@");
  const version = Number(catalogKey.slice(versionSeparator + 1));
  if (
    versionSeparator <= 0 ||
    !Number.isInteger(version) ||
    version < 1 ||
    chapterId.length === 0
  ) {
    return undefined;
  }
  return {
    reference: {
      storyId: catalogKey.slice(0, versionSeparator),
      version,
    },
    chapterId,
  };
}

function termPeriodFromMetadata(
  metadata: Record<string, unknown>,
): TermPeriod | null {
  if (
    typeof metadata.term_token !== "string" ||
    typeof metadata.period_key !== "string" ||
    !Number.isInteger(metadata.week_index)
  ) {
    return null;
  }
  const totalPeriods = Number.isInteger(metadata.term_week_count)
    ? (metadata.term_week_count as number)
    : LEGACY_TERM_PERIODS;
  return {
    termKey: metadata.term_token,
    totalPeriods,
    periodKey: metadata.period_key,
    periodNumber: metadata.week_index as number,
  };
}

async function termPeriodForEvent(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
): Promise<TermPeriod | null> {
  if (event.event_type === "daily_log_week.configured") {
    return termPeriodFromMetadata(event.metadata);
  }
  const periodKey = event.metadata.period_key;
  if (typeof periodKey !== "string") return null;

  const [calendarFact] = await db
    .select({ metadata: learnerFacts.metadata })
    .from(learnerFacts)
    .where(
      and(
        eq(learnerFacts.learnerId, learnerId),
        eq(learnerFacts.eventType, "daily_log_week.configured"),
        eq(learnerFacts.periodKey, periodKey),
        sql`${learnerFacts.metadata} ? 'term_token'`,
      ),
    )
    .orderBy(
      sql`(${learnerFacts.metadata} ? 'term_week_count') desc`,
      sql`(${learnerFacts.metadata}->>'config_version')::int desc`,
    )
    .limit(1);
  return calendarFact
    ? termPeriodFromMetadata(calendarFact.metadata as Record<string, unknown>)
    : null;
}

async function resolveStoryPlanRow(
  db: Db,
  learnerId: string,
  termKey: string,
) {
  const [plan] = await db
    .select()
    .from(storyPlans)
    .where(
      and(
        eq(storyPlans.learnerId, learnerId),
        eq(storyPlans.termKey, termKey),
      ),
    )
    .limit(1);
  return plan;
}

/**
 * Creates one complete deterministic plan and binds the configured opaque
 * period to its chapter. The caller already owns the learner row lock.
 */
export async function ensureStoryPlanForEvent(
  db: Db,
  learnerId: string,
  event: IncomingEvent,
  defaultStory: PalStoryReference = DEFAULT_PAL_STORY,
): Promise<void> {
  const termPeriod = await termPeriodForEvent(db, learnerId, event);
  if (!termPeriod) return;

  let plan = await resolveStoryPlanRow(db, learnerId, termPeriod.termKey);
  if (!plan) {
    const generated = createPalStoryPlan(termPeriod.totalPeriods, defaultStory);
    const [created] = await db
      .insert(storyPlans)
      .values({
        learnerId,
        termKey: termPeriod.termKey,
        storyId: generated.storyId,
        storyVersion: generated.version,
        totalPeriods: generated.totalPeriods,
      })
      .onConflictDoNothing()
      .returning();
    plan = created ?? await resolveStoryPlanRow(db, learnerId, termPeriod.termKey);
    if (!plan) throw new Error("Failed to create or resolve the learner story plan");
    if (created) {
      await db.insert(storyPlanChapters).values(
        generated.chapters.map((chapter) => ({
          storyPlanId: created.id,
          learnerId,
          periodNumber: chapter.roadmapWeek,
          chapterId: chapter.id,
        })),
      );
    }
  }

  const catalog = getPalStoryCatalog(
    storyReference(plan.storyId, plan.storyVersion),
  );
  if (!catalog || plan.totalPeriods !== termPeriod.totalPeriods) {
    throw new Error("Configured term does not match its persisted story plan");
  }

  const [assignment] = await db
    .select()
    .from(storyPlanChapters)
    .where(
      and(
        eq(storyPlanChapters.storyPlanId, plan.id),
        eq(storyPlanChapters.periodNumber, termPeriod.periodNumber),
      ),
    )
    .limit(1);
  if (!assignment) throw new Error("Story plan is missing its configured period");
  if (assignment.periodKey && assignment.periodKey !== termPeriod.periodKey) {
    throw new Error("Story period is already bound to another opaque period");
  }
  if (!assignment.periodKey) {
    await db
      .update(storyPlanChapters)
      .set({ periodKey: termPeriod.periodKey, updatedAt: new Date() })
      .where(eq(storyPlanChapters.id, assignment.id));
  }
}

/** Loads the exact persisted chapter order instead of regenerating it. */
export async function loadPersistedStoryPlan(
  db: Db,
  learnerId: string,
  termKey: string,
): Promise<PalStoryPlan | undefined> {
  const plan = await resolveStoryPlanRow(db, learnerId, termKey);
  if (!plan) return undefined;
  const reference = storyReference(plan.storyId, plan.storyVersion);
  const catalog = getPalStoryCatalog(reference);
  if (!catalog) {
    throw new Error("Unsupported persisted story plan version");
  }
  const rows = await db
    .select()
    .from(storyPlanChapters)
    .where(
      and(
        eq(storyPlanChapters.storyPlanId, plan.id),
        eq(storyPlanChapters.learnerId, learnerId),
      ),
    )
    .orderBy(asc(storyPlanChapters.periodNumber));
  if (rows.length !== plan.totalPeriods) {
    throw new Error("Persisted story plan is incomplete");
  }

  return {
    storyId: plan.storyId,
    version: plan.storyVersion,
    companionCollectibleId: catalog.companionCollectibleId,
    mysteryCollectibleId: catalog.mysteryCollectibleId,
    totalPeriods: plan.totalPeriods,
    chapters: rows.map((row) => {
      const chapter = getPalStoryChapterDefinition(reference, row.chapterId);
      if (!chapter) throw new Error(`Unknown persisted story chapter: ${row.chapterId}`);
      return {
        ...chapter,
        roadmapWeek: row.periodNumber,
        sourceChapterIds: [row.chapterId],
      };
    }),
  };
}

/** Inserts at most one story notice for the weekly achievement instance. */
export async function awardStoryCollectibleForPeriod(
  db: Db,
  learnerId: string,
  periodKey: string,
  achievementInstanceId: string,
  sourceFactId: string,
  earnedAt: Date,
): Promise<void> {
  const [assignment] = await db
    .select({
      chapterId: storyPlanChapters.chapterId,
      storyId: storyPlans.storyId,
      storyVersion: storyPlans.storyVersion,
    })
    .from(storyPlanChapters)
    .innerJoin(
      storyPlans,
      and(
        eq(storyPlans.id, storyPlanChapters.storyPlanId),
        eq(storyPlans.learnerId, storyPlanChapters.learnerId),
      ),
    )
    .where(
      and(
        eq(storyPlanChapters.learnerId, learnerId),
        eq(storyPlanChapters.periodKey, periodKey),
      ),
    )
    .limit(1);
  if (!assignment) return;
  const reference = storyReference(
    assignment.storyId,
    assignment.storyVersion,
  );
  const chapter = getPalStoryChapterDefinition(reference, assignment.chapterId);
  if (!chapter) throw new Error(`Unknown story reward chapter: ${assignment.chapterId}`);

  if (chapter.title) {
    await awardLearnerTitle(db, {
      learnerId,
      titleId: chapter.title.id,
      kind: "story",
      sourceFactId,
      earnedAt,
    });
  }

  await db
    .insert(rewardNotices)
    .values({
      learnerId,
      achievementInstanceId,
      rewardKey: storyRewardKey(reference, assignment.chapterId),
      title: chapter.revealHeadline,
      description: chapter.storyCopy,
    })
    .onConflictDoNothing();
}

export function storyRewardDetails(rewardKey: string) {
  const parsed = parseStoryRewardKey(rewardKey);
  if (!parsed) return undefined;
  const chapter = getPalStoryChapterDefinition(
    parsed.reference,
    parsed.chapterId,
  );
  if (!chapter) return undefined;
  return {
    kind: "story" as const,
    collectibleTitle: chapter.collectible.title,
    assetUrl: chapter.collectible.assetUrl,
    ...(chapter.title
      ? {
          titleAward: chapter.title.label,
          titleRevealCopy: chapter.title.revealCopy,
        }
      : {}),
  };
}
