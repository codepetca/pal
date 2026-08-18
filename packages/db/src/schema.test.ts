import assert from "node:assert/strict";
import { after, test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  events,
  integrations,
  learnerFacts,
  learnerRewardGrants,
  learners,
  rewardNotices,
  storyCollectibleSchedules,
  storyPlanChapters,
  storyPlans,
  weeklyRhythmConfigs,
} from "./schema";
import { getDb, getPool } from "./client";

let openedDatabase = false;

function foreignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    candidate.code === "23503" ||
    (candidate.cause !== undefined && foreignKeyViolation(candidate.cause))
  );
}

function postgresViolation(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    candidate.code === code ||
    (candidate.cause !== undefined && postgresViolation(candidate.cause, code))
  );
}

test(
  "rejects cross-owner events, facts, achievements, periods, and rewards",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const db = getDb();
    const suffix = crypto.randomUUID();
    const [integrationA, integrationB] = await db
      .insert(integrations)
      .values([
        {
          slug: `schema-a-${suffix}`,
          name: "Schema A",
          secretHash: `schema-secret-a-${suffix}`,
          allowedEventTypes: [],
        },
        {
          slug: `schema-b-${suffix}`,
          name: "Schema B",
          secretHash: `schema-secret-b-${suffix}`,
          allowedEventTypes: [],
        },
      ])
      .returning({ id: integrations.id });

    try {
      const [learnerA, learnerB] = await db
        .insert(learners)
        .values([
          {
            integrationId: integrationA.id,
            externalLearnerId: `learner-a-${suffix}`,
          },
          {
            integrationId: integrationB.id,
            externalLearnerId: `learner-b-${suffix}`,
          },
        ])
        .returning({ id: learners.id });

      const [periodA, periodB] = await db
        .insert(achievementPeriods)
        .values([
          {
            learnerId: learnerA.id,
            periodKey: `week-a-${suffix}`,
            anchorAt: new Date(),
          },
          {
            learnerId: learnerB.id,
            periodKey: `week-b-${suffix}`,
            anchorAt: new Date(),
          },
        ])
        .returning({ periodKey: achievementPeriods.periodKey });

      const planInput = {
        learnerId: learnerA.id,
        termKey: `term-${suffix}`,
        termStartDay: "2026-08-31",
        storyId: "pips-first-recipe",
        storyVersion: 1,
        totalPeriods: 6,
      };
      for (const invalid of [
        { ...planInput, termKey: `term-short-${suffix}`, totalPeriods: 5 },
        { ...planInput, termKey: `term-long-${suffix}`, totalPeriods: 25 },
        { ...planInput, termKey: `term-version-${suffix}`, storyVersion: 0 },
      ]) {
        await assert.rejects(
          db.insert(storyPlans).values(invalid),
          (error) => postgresViolation(error, "23514"),
        );
      }

      for (const [index, [termKey, storyId, firstChapterId]] of [
        ["", "pips-first-recipe", "chapter-1"],
        ["   ", "pips-first-recipe", "chapter-1"],
        [`invalid-story-empty-${suffix}`, "", "chapter-1"],
        [`invalid-story-blank-${suffix}`, "   ", "chapter-1"],
        [`invalid-chapter-empty-${suffix}`, "pips-first-recipe", ""],
        [`invalid-chapter-blank-${suffix}`, "pips-first-recipe", "   "],
      ].entries()) {
        await assert.rejects(
          db.transaction(async (tx) => {
            const [invalidPlan] = await tx
              .insert(storyPlans)
              .values({ ...planInput, termKey, storyId })
              .returning({ id: storyPlans.id });
            await tx.insert(storyPlanChapters).values(
              Array.from({ length: 6 }, (_, chapterIndex) => ({
                storyPlanId: invalidPlan.id,
                learnerId: learnerA.id,
                periodNumber: chapterIndex + 1,
                chapterId:
                  chapterIndex === 0
                    ? firstChapterId
                    : `invalid-identifier-${index}-chapter-${chapterIndex + 1}`,
              })),
            );
          }),
          (error) => postgresViolation(error, "23514"),
        );
      }

      const plan = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(storyPlans)
          .values(planInput)
          .returning({ id: storyPlans.id });
        await tx.insert(storyPlanChapters).values(
          Array.from({ length: 6 }, (_, index) => ({
            storyPlanId: created.id,
            learnerId: learnerA.id,
            periodNumber: index + 1,
            ...(index === 0 ? { periodKey: periodA.periodKey } : {}),
            chapterId: `chapter-${index + 1}`,
          })),
        );
        return created;
      });
      await assert.rejects(
        db.insert(storyPlans).values(planInput),
        (error) => postgresViolation(error, "23505"),
      );

      for (const invalid of [
        {
          storyPlanId: plan.id,
          learnerId: learnerA.id,
          periodNumber: 0,
          chapterId: "invalid-period",
        },
        {
          storyPlanId: plan.id,
          learnerId: learnerA.id,
          periodNumber: 7,
          chapterId: "",
        },
      ]) {
        await assert.rejects(
          db.insert(storyPlanChapters).values(invalid),
          (error) => postgresViolation(error, "23514"),
        );
      }
      for (const duplicate of [
        {
          storyPlanId: plan.id,
          learnerId: learnerA.id,
          periodNumber: 1,
          chapterId: "different-chapter",
        },
        {
          storyPlanId: plan.id,
          learnerId: learnerA.id,
          periodNumber: 2,
          chapterId: "chapter-1",
        },
        {
          storyPlanId: plan.id,
          learnerId: learnerA.id,
          periodNumber: 2,
          periodKey: periodA.periodKey,
          chapterId: "different-chapter",
        },
      ]) {
        await assert.rejects(
          db.insert(storyPlanChapters).values(duplicate),
          (error) => postgresViolation(error, "23505"),
        );
      }

      const [boundChapter] = await db
        .select({ id: storyPlanChapters.id })
        .from(storyPlanChapters)
        .where(
          and(
            eq(storyPlanChapters.storyPlanId, plan.id),
            eq(storyPlanChapters.periodNumber, 1),
          ),
        );
      for (const foreignPeriodKey of [periodB.periodKey, `missing-${suffix}`]) {
        await assert.rejects(
          db
            .update(storyPlanChapters)
            .set({ periodKey: foreignPeriodKey })
            .where(eq(storyPlanChapters.id, boundChapter.id)),
          (error) => postgresViolation(error, "23514"),
        );
      }

      for (const [termKey, periodNumbers] of [
        [`term-incomplete-${suffix}`, [1, 2, 3, 4, 5]],
        [`term-gapped-${suffix}`, [1, 2, 3, 4, 5, 24]],
      ] as const) {
        await assert.rejects(
          db.transaction(async (tx) => {
            const [invalidPlan] = await tx
              .insert(storyPlans)
              .values({ ...planInput, termKey })
              .returning({ id: storyPlans.id });
            await tx.insert(storyPlanChapters).values(
              periodNumbers.map((periodNumber, index) => ({
                storyPlanId: invalidPlan.id,
                learnerId: learnerA.id,
                periodNumber,
                chapterId: `${termKey}-chapter-${index + 1}`,
              })),
            );
          }),
          (error) => postgresViolation(error, "23514"),
        );
      }

      for (const change of [
        { id: crypto.randomUUID() },
        { createdAt: new Date(0) },
        { totalPeriods: 7 },
        { storyVersion: 2 },
        { storyId: "replacement-story" },
        { termStartDay: "2026-09-01" },
      ]) {
        await assert.rejects(
          db.update(storyPlans).set(change).where(eq(storyPlans.id, plan.id)),
          (error) => postgresViolation(error, "23514"),
        );
      }
      for (const change of [
        { id: crypto.randomUUID() },
        { createdAt: new Date(0) },
        { chapterId: "replacement-chapter" },
      ]) {
        await assert.rejects(
          db
            .update(storyPlanChapters)
            .set(change)
            .where(eq(storyPlanChapters.id, boundChapter.id)),
          (error) => postgresViolation(error, "23514"),
        );
      }

      await assert.rejects(
        db.transaction(async (tx) => {
          const [replaceableChapter] = await tx
            .select()
            .from(storyPlanChapters)
            .where(
              and(
                eq(storyPlanChapters.storyPlanId, plan.id),
                eq(storyPlanChapters.periodNumber, 6),
              ),
            );
          await tx
            .delete(storyPlanChapters)
            .where(eq(storyPlanChapters.id, replaceableChapter.id));
          await tx.insert(storyPlanChapters).values({
            storyPlanId: plan.id,
            learnerId: learnerA.id,
            periodNumber: replaceableChapter.periodNumber,
            periodKey: replaceableChapter.periodKey,
            chapterId: "replacement-chapter",
          });
        }),
        (error) => postgresViolation(error, "23514"),
      );

      const destinationPlan = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(storyPlans)
          .values({ ...planInput, termKey: `destination-term-${suffix}` })
          .returning({ id: storyPlans.id });
        await tx.insert(storyPlanChapters).values(
          Array.from({ length: 6 }, (_, index) => ({
            storyPlanId: created.id,
            learnerId: learnerA.id,
            periodNumber: index + 1,
            chapterId: `destination-chapter-${index + 1}`,
          })),
        );
        return created;
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx
            .delete(storyPlanChapters)
            .where(
              and(
                eq(storyPlanChapters.storyPlanId, destinationPlan.id),
                eq(storyPlanChapters.periodNumber, 6),
              ),
            );
          await tx
            .update(storyPlanChapters)
            .set({
              storyPlanId: destinationPlan.id,
              chapterId: "destination-replacement-chapter",
            })
            .where(
              and(
                eq(storyPlanChapters.storyPlanId, plan.id),
                eq(storyPlanChapters.periodNumber, 6),
              ),
            );
        }),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.delete(storyPlans).where(eq(storyPlans.id, destinationPlan.id)),
        (error) => postgresViolation(error, "23514"),
      );

      await assert.rejects(
        db.insert(events).values({
          integrationId: integrationB.id,
          learnerId: learnerA.id,
          idempotencyKey: `mismatched-event-${suffix}`,
          eventType: "platform.session.started",
          occurredAt: new Date(),
          metadata: {},
        }),
        foreignKeyViolation,
      );

      const [eventA, eventB] = await db
        .insert(events)
        .values([
          {
            integrationId: integrationA.id,
            learnerId: learnerA.id,
            idempotencyKey: `event-a-${suffix}`,
            eventType: "platform.session.started",
            occurredAt: new Date(),
            metadata: {},
          },
          {
            integrationId: integrationB.id,
            learnerId: learnerB.id,
            idempotencyKey: `event-b-${suffix}`,
            eventType: "platform.session.started",
            occurredAt: new Date(),
            metadata: {},
          },
        ])
        .returning({ id: events.id });

      await assert.rejects(
        db.insert(learnerFacts).values({
          integrationId: integrationA.id,
          learnerId: learnerA.id,
          sourceEventId: eventB.id,
          eventType: "platform.session.started",
          semanticKey: `mismatched-fact-${suffix}`,
          occurredAt: new Date(),
          metadata: {},
        }),
        foreignKeyViolation,
      );

      const [factA] = await db
        .insert(learnerFacts)
        .values({
          integrationId: integrationA.id,
          learnerId: learnerA.id,
          sourceEventId: eventA.id,
          eventType: "platform.session.started",
          semanticKey: `fact-a-${suffix}`,
          occurredAt: new Date(),
          metadata: {},
        })
        .returning({ id: learnerFacts.id });
      const [factA2] = await db
        .insert(learnerFacts)
        .values({
          integrationId: integrationA.id,
          learnerId: learnerA.id,
          sourceEventId: eventA.id,
          eventType: "platform.session.started",
          semanticKey: `fact-a2-${suffix}`,
          occurredAt: new Date(),
          metadata: {},
        })
        .returning({ id: learnerFacts.id });

      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learnerB.id,
          periodKey: `cross-owner-schedule-${suffix}`,
          sourceFactId: factA.id,
          dueAt: new Date(),
        }),
        foreignKeyViolation,
      );

      const [secondChapter] = await db
        .select({ id: storyPlanChapters.id })
        .from(storyPlanChapters)
        .where(
          and(
            eq(storyPlanChapters.storyPlanId, plan.id),
            eq(storyPlanChapters.periodNumber, 2),
          ),
        );
      await assert.rejects(
        db
          .update(storyPlanChapters)
          .set({ periodKey: periodB.periodKey })
          .where(eq(storyPlanChapters.id, secondChapter.id)),
        foreignKeyViolation,
      );

      for (const invalidGrant of [
        {
          learnerId: learnerA.id,
          kind: "story_chapter",
          sourceFactId: factA.id,
          behaviorTitleId: "not-a-story-payload",
        },
        {
          learnerId: learnerA.id,
          kind: "behavior_title",
          sourceFactId: factA.id,
          behaviorTitleId: "   ",
        },
      ]) {
        await assert.rejects(
          db.insert(learnerRewardGrants).values(invalidGrant),
          (error) => postgresViolation(error, "23514"),
        );
      }

      await assert.rejects(
        db.insert(learnerRewardGrants).values({
          learnerId: learnerB.id,
          kind: "behavior_title",
          sourceFactId: factA.id,
          behaviorTitleId: "cross-owner",
        }),
        foreignKeyViolation,
      );

      const [storyGrant] = await db
        .insert(learnerRewardGrants)
        .values({
          learnerId: learnerA.id,
          kind: "story_chapter",
          sourceFactId: factA.id,
          storyPlanId: plan.id,
          storyPlanChapterId: boundChapter.id,
        })
        .returning({
          id: learnerRewardGrants.id,
          grantOrder: learnerRewardGrants.grantOrder,
        });
      await assert.rejects(
        db
          .update(storyPlanChapters)
          .set({ id: crypto.randomUUID() })
          .where(eq(storyPlanChapters.id, boundChapter.id)),
        (error) => postgresViolation(error, "23514"),
      );
      const [behaviorGrant] = await db
        .insert(learnerRewardGrants)
        .values({
          learnerId: learnerA.id,
          kind: "behavior_title",
          sourceFactId: factA.id,
          behaviorTitleId: "rhythm-builder",
        })
        .returning({ grantOrder: learnerRewardGrants.grantOrder });
      assert.ok(behaviorGrant.grantOrder > storyGrant.grantOrder);

      await assert.rejects(
        db.insert(learnerRewardGrants).values({
          learnerId: learnerA.id,
          kind: "story_chapter",
          sourceFactId: factA.id,
          storyPlanId: plan.id,
          storyPlanChapterId: secondChapter.id,
        }),
        (error) => postgresViolation(error, "23505"),
      );
      await assert.rejects(
        db.insert(learnerRewardGrants).values({
          learnerId: learnerA.id,
          kind: "story_chapter",
          sourceFactId: factA2.id,
          storyPlanId: destinationPlan.id,
          storyPlanChapterId: secondChapter.id,
        }),
        foreignKeyViolation,
      );
      await assert.rejects(
        db.insert(learnerRewardGrants).values({
          learnerId: learnerA.id,
          kind: "story_chapter",
          sourceFactId: factA2.id,
          storyPlanId: plan.id,
          storyPlanChapterId: boundChapter.id,
        }),
        (error) => postgresViolation(error, "23505"),
      );
      await assert.rejects(
        db.insert(learnerRewardGrants).values({
          learnerId: learnerA.id,
          kind: "behavior_title",
          sourceFactId: factA.id,
          behaviorTitleId: "rhythm-builder",
        }),
        (error) => postgresViolation(error, "23505"),
      );

      await db.execute(
        sql.raw(
          "ALTER SEQUENCE learner_reward_grants_grant_order_seq RESTART WITH 9007199254740992",
        ),
      );
      const [firstLargeOrder] = await db
        .insert(learnerRewardGrants)
        .values({
          learnerId: learnerA.id,
          kind: "behavior_title",
          sourceFactId: factA2.id,
          behaviorTitleId: "lossless-order-a",
        })
        .returning({ grantOrder: learnerRewardGrants.grantOrder });
      const [secondLargeOrder] = await db
        .insert(learnerRewardGrants)
        .values({
          learnerId: learnerA.id,
          kind: "behavior_title",
          sourceFactId: factA2.id,
          behaviorTitleId: "lossless-order-b",
        })
        .returning({ grantOrder: learnerRewardGrants.grantOrder });
      assert.equal(
        firstLargeOrder.grantOrder,
        BigInt("9007199254740992"),
      );
      assert.equal(
        secondLargeOrder.grantOrder,
        BigInt("9007199254740993"),
      );
      assert.notEqual(firstLargeOrder.grantOrder, secondLargeOrder.grantOrder);

      const acknowledgedAt = new Date();
      await db
        .update(learnerRewardGrants)
        .set({ seenAt: acknowledgedAt })
        .where(eq(learnerRewardGrants.id, storyGrant.id));
      for (const seenAt of [null, new Date(acknowledgedAt.getTime() + 1)]) {
        await assert.rejects(
          db
            .update(learnerRewardGrants)
            .set({ seenAt })
            .where(eq(learnerRewardGrants.id, storyGrant.id)),
          (error) => postgresViolation(error, "23514"),
        );
      }
      await assert.rejects(
        db
          .update(learnerRewardGrants)
          .set({ sourceFactId: crypto.randomUUID() })
          .where(eq(learnerRewardGrants.id, storyGrant.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db
          .delete(learnerRewardGrants)
          .where(eq(learnerRewardGrants.id, storyGrant.id)),
        (error) => postgresViolation(error, "23514"),
      );

      await assert.rejects(
        db.insert(weeklyRhythmConfigs).values({
          learnerId: learnerB.id,
          periodKey: periodA.periodKey,
          configVersion: 1,
          periodStatus: "open",
          eligibleDays: 3,
          configuredAt: new Date(),
        }),
        foreignKeyViolation,
      );

      await assert.rejects(
        db.insert(achievementInstances).values({
          learnerId: learnerB.id,
          achievementKey: "first-pika-login",
          scopeKey: "lifetime",
          status: "earned",
          sourceFactId: factA.id,
        }),
        foreignKeyViolation,
      );

      const [achievementA] = await db
        .insert(achievementInstances)
        .values({
          learnerId: learnerA.id,
          achievementKey: "first-pika-login",
          scopeKey: "lifetime",
          status: "earned",
          sourceFactId: factA.id,
        })
        .returning({ id: achievementInstances.id });

      await assert.rejects(
        db.insert(rewardNotices).values({
          learnerId: learnerB.id,
          achievementInstanceId: achievementA.id,
          rewardKey: "mismatched-reward",
          title: "Must fail",
          description: "Must not cross learner ownership",
        }),
        foreignKeyViolation,
      );

      await db.insert(rewardNotices).values({
        learnerId: learnerA.id,
        achievementInstanceId: achievementA.id,
        rewardKey: "valid-reward",
        title: "Valid",
        description: "Owned by learner A",
      });
      await db.delete(integrations).where(eq(integrations.id, integrationB.id));
      assert.equal(
        (
          await db
            .select({ id: rewardNotices.id })
            .from(rewardNotices)
            .where(eq(rewardNotices.learnerId, learnerA.id))
        ).length,
        1,
      );
    } finally {
      await db
        .delete(integrations)
        .where(eq(integrations.id, integrationA.id));
      await db
        .delete(integrations)
        .where(eq(integrations.id, integrationB.id));
    }
  },
);

test(
  "uses the event-period index for bounded daily-log reads",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const db = getDb();
    const suffix = crypto.randomUUID();
    const [integration] = await db
      .insert(integrations)
      .values({
        slug: `index-plan-${suffix}`,
        name: "Index Plan",
        secretHash: `index-plan-secret-${suffix}`,
        allowedEventTypes: [],
      })
      .returning({ id: integrations.id });
    try {
      const [learner] = await db
        .insert(learners)
        .values({
          integrationId: integration.id,
          externalLearnerId: `index-plan-learner-${suffix}`,
        })
        .returning({ id: learners.id });
      const factCount = 505;
      const sourceEvents = await db
        .insert(events)
        .values(
          Array.from({ length: factCount }, (_, index) => ({
            integrationId: integration.id,
            learnerId: learner.id,
            idempotencyKey: `index-plan-event-${index}-${suffix}`,
            eventType:
              index < 500 ? "learning_item.completed" : "daily_log.completed",
            occurredAt: new Date(Date.UTC(2026, 0, 1, 12, index)),
            metadata: {},
          })),
        )
        .returning({ id: events.id, eventType: events.eventType });
      await db.insert(learnerFacts).values(
        sourceEvents.map((sourceEvent, index) => ({
          integrationId: integration.id,
          learnerId: learner.id,
          sourceEventId: sourceEvent.id,
          eventType: sourceEvent.eventType,
          semanticKey: `index-plan-fact-${index}-${suffix}`,
          periodKey: `index-plan-period-${suffix}`,
          occurredAt: new Date(Date.UTC(2026, 0, 1, 12, index)),
          metadata: {},
        })),
      );

      const explained = await getPool().query(
        `EXPLAIN (ANALYZE, FORMAT JSON)
         SELECT id
         FROM learner_facts
         WHERE learner_id = $1
           AND event_type = 'daily_log.completed'
           AND period_key = $2
         LIMIT 6`,
        [learner.id, `index-plan-period-${suffix}`],
      );
      const root = explained.rows[0]?.["QUERY PLAN"]?.[0]?.Plan as
        | Record<string, unknown>
        | undefined;
      assert.ok(root);
      const nodes: Record<string, unknown>[] = [];
      const visit = (node: Record<string, unknown>) => {
        nodes.push(node);
        const children = node.Plans;
        if (Array.isArray(children)) {
          for (const child of children) {
            if (child && typeof child === "object") {
              visit(child as Record<string, unknown>);
            }
          }
        }
      };
      visit(root);
      assert.ok(
        nodes.some(
          (node) =>
            node["Index Name"] === "learner_facts_event_period_idx" &&
            Number(node["Actual Rows"]) <= 5,
        ),
      );
      assert.equal(nodes.some((node) => node["Node Type"] === "Sort"), false);
    } finally {
      await db.delete(integrations).where(eq(integrations.id, integration.id));
    }
  },
);

test(
  "materializes one immutable typed story schedule from the first valid weekly fact",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const db = getDb();
    const suffix = crypto.randomUUID();
    const [integration] = await db.insert(integrations).values({
      slug: `story-schedule-${suffix}`,
      name: "Story Schedule",
      secretHash: `story-schedule-secret-${suffix}`,
      allowedEventTypes: [],
    }).returning({ id: integrations.id });
    try {
      const [learner] = await db.insert(learners).values({
        integrationId: integration.id,
        externalLearnerId: `story-schedule-learner-${suffix}`,
      }).returning({ id: learners.id });
      const periodKey = `story-schedule-period-${suffix}`;
      const sourceEvents = await db.insert(events).values([
        {
          integrationId: integration.id,
          learnerId: learner.id,
          idempotencyKey: `story-schedule-event-1-${suffix}`,
          eventType: "daily_log_week.configured",
          occurredAt: new Date("2026-08-31T12:00:00.000Z"),
          metadata: {},
        },
        {
          integrationId: integration.id,
          learnerId: learner.id,
          idempotencyKey: `story-schedule-event-2-${suffix}`,
          eventType: "daily_log_week.configured",
          occurredAt: new Date("2026-09-01T12:00:00.000Z"),
          metadata: {},
        },
      ]).returning({ id: events.id });

      const calendar = {
        term_token: `story-schedule-term-${suffix}`,
        term_start_day: "2026-08-31",
        term_end_day: "2026-10-09",
        term_timezone: "America/Toronto",
        term_week_count: 6,
        week_start_day: "2026-08-31",
        week_index: 1,
      };
      const [firstFact] = await db.insert(learnerFacts).values({
        integrationId: integration.id,
        learnerId: learner.id,
        sourceEventId: sourceEvents[0]!.id,
        eventType: "daily_log_week.configured",
        semanticKey: `${periodKey}:1`,
        periodKey,
        occurredAt: new Date("2026-08-31T12:00:00.000Z"),
        metadata: calendar,
      }).returning({
        id: learnerFacts.id,
        createdAt: learnerFacts.createdAt,
      });
      await db.insert(learnerFacts).values({
        integrationId: integration.id,
        learnerId: learner.id,
        sourceEventId: sourceEvents[1]!.id,
        eventType: "daily_log_week.configured",
        semanticKey: `${periodKey}:2`,
        periodKey,
        occurredAt: new Date("2026-09-01T12:00:00.000Z"),
        metadata: calendar,
      });

      const schedules = await db.select().from(storyCollectibleSchedules).where(
        eq(storyCollectibleSchedules.learnerId, learner.id),
      );
      assert.equal(schedules.length, 1);
      assert.equal(schedules[0]!.sourceFactId, firstFact.id);
      assert.equal(schedules[0]!.dueAt.toISOString(), "2026-09-05T04:00:00.000Z");
      assert.equal(schedules[0]!.reconciledAt, null);

      const [nonConfigurationEvent] = await db.insert(events).values({
        integrationId: integration.id,
        learnerId: learner.id,
        idempotencyKey: `story-schedule-non-config-event-${suffix}`,
        eventType: "learning_item.completed",
        occurredAt: new Date("2026-08-31T13:00:00.000Z"),
        metadata: {},
      }).returning({ id: events.id });
      const [nonConfigurationFact] = await db.insert(learnerFacts).values({
        integrationId: integration.id,
        learnerId: learner.id,
        sourceEventId: nonConfigurationEvent.id,
        eventType: "learning_item.completed",
        semanticKey: `story-schedule-non-config-fact-${suffix}`,
        periodKey: `story-schedule-non-config-period-${suffix}`,
        occurredAt: new Date("2026-08-31T13:00:00.000Z"),
        metadata: {},
      }).returning({
        id: learnerFacts.id,
        createdAt: learnerFacts.createdAt,
      });

      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learner.id,
          periodKey: `story-schedule-non-config-period-${suffix}`,
          sourceFactId: nonConfigurationFact.id,
          dueAt: new Date("2026-09-05T04:00:00.000Z"),
          createdAt: nonConfigurationFact.createdAt,
        }),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learner.id,
          periodKey: `story-schedule-forged-period-${suffix}`,
          sourceFactId: firstFact.id,
          dueAt: new Date("2026-09-05T04:00:00.000Z"),
          createdAt: firstFact.createdAt,
        }),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learner.id,
          periodKey,
          sourceFactId: firstFact.id,
          dueAt: new Date("2026-09-06T04:00:00.000Z"),
          createdAt: firstFact.createdAt,
        }),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learner.id,
          periodKey,
          sourceFactId: firstFact.id,
          dueAt: new Date("2026-09-05T04:00:00.000Z"),
          createdAt: new Date(firstFact.createdAt.getTime() + 1),
        }),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.insert(storyCollectibleSchedules).values({
          learnerId: learner.id,
          periodKey,
          sourceFactId: firstFact.id,
          dueAt: new Date("2026-09-05T04:00:00.000Z"),
          createdAt: firstFact.createdAt,
          reconciledAt: new Date("2026-09-06T04:00:00.000Z"),
        }),
        (error) => postgresViolation(error, "23514"),
      );

      await assert.rejects(
        db.update(learnerFacts).set({
          eventType: "learning_item.completed",
        }).where(eq(learnerFacts.id, firstFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.update(learnerFacts).set({
          periodKey: `story-schedule-mutated-period-${suffix}`,
        }).where(eq(learnerFacts.id, firstFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.update(learnerFacts).set({
          metadata: { ...calendar, week_index: 2 },
        }).where(eq(learnerFacts.id, firstFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.update(learnerFacts).set({
          createdAt: new Date(firstFact.createdAt.getTime() + 1),
        }).where(eq(learnerFacts.id, firstFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.delete(learnerFacts).where(eq(learnerFacts.id, firstFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.update(learnerFacts).set({
          metadata: { forged: true },
        }).where(eq(learnerFacts.id, nonConfigurationFact.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.delete(learnerFacts).where(eq(learnerFacts.id, nonConfigurationFact.id)),
        (error) => postgresViolation(error, "23514"),
      );

      await assert.rejects(
        db.update(storyCollectibleSchedules).set({
          dueAt: new Date("2026-09-06T04:00:00.000Z"),
        }).where(eq(storyCollectibleSchedules.id, schedules[0]!.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.update(storyCollectibleSchedules).set({
          reconciledAt: new Date(),
        }).where(eq(storyCollectibleSchedules.id, schedules[0]!.id)),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        db.delete(storyCollectibleSchedules).where(
          eq(storyCollectibleSchedules.id, schedules[0]!.id),
        ),
        (error) => postgresViolation(error, "23514"),
      );

      await db.delete(learners).where(eq(learners.id, learner.id));
      assert.equal(
        (await db.select().from(storyCollectibleSchedules).where(
          eq(storyCollectibleSchedules.learnerId, learner.id),
        )).length,
        0,
      );
    } finally {
      await db.delete(integrations).where(eq(integrations.id, integration.id));
    }
  },
);

test(
  "runtime story schedule guards ignore temporary relation shadowing",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const db = getDb();
    const suffix = crypto.randomUUID();
    const [integration] = await db.insert(integrations).values({
      slug: `story-shadow-${suffix}`,
      name: "Story Shadow",
      secretHash: `story-shadow-secret-${suffix}`,
      allowedEventTypes: [],
    }).returning({ id: integrations.id });
    const [learner] = await db.insert(learners).values({
      integrationId: integration.id,
      externalLearnerId: `story-shadow-learner-${suffix}`,
    }).returning({ id: learners.id });
    const [configurationEvent, nonConfigurationEvent] = await db.insert(events)
      .values([
        {
          integrationId: integration.id,
          learnerId: learner.id,
          idempotencyKey: `story-shadow-config-event-${suffix}`,
          eventType: "daily_log_week.configured",
          occurredAt: new Date("2026-08-31T12:00:00.000Z"),
          metadata: {},
        },
        {
          integrationId: integration.id,
          learnerId: learner.id,
          idempotencyKey: `story-shadow-item-event-${suffix}`,
          eventType: "learning_item.completed",
          occurredAt: new Date("2026-08-31T13:00:00.000Z"),
          metadata: {},
        },
      ]).returning({ id: events.id });
    const client = await getPool().connect();
    const calendar = {
      term_token: `story-shadow-term-${suffix}`,
      term_start_day: "2026-08-31",
      term_end_day: "2026-10-09",
      term_timezone: "America/Toronto",
      term_week_count: 6,
      week_start_day: "2026-08-31",
      week_index: 1,
    };
    try {
      await client.query(
        `CREATE TEMP TABLE story_collectible_schedules
           (LIKE public.story_collectible_schedules INCLUDING ALL);
         CREATE TEMP TABLE pg_timezone_names (name text);`,
      );

      const validFact = await client.query(
        `INSERT INTO public.learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata
         ) VALUES ($1, $2, $3, 'daily_log_week.configured', $4, $5,
           '2026-08-31T12:00:00Z', $6)
         RETURNING id, created_at`,
        [
          integration.id,
          learner.id,
          configurationEvent!.id,
          `story-shadow-config-fact-${suffix}`,
          `story-shadow-period-${suffix}`,
          calendar,
        ],
      );
      assert.equal(
        Number((await client.query(
          `SELECT count(*) AS count
           FROM public.story_collectible_schedules
           WHERE learner_id = $1`,
          [learner.id],
        )).rows[0].count),
        1,
      );
      assert.equal(
        Number((await client.query(
          `SELECT count(*) AS count FROM pg_temp.story_collectible_schedules`,
        )).rows[0].count),
        0,
      );

      const fakeChapterId = crypto.randomUUID();
      await client.query(
        `CREATE TEMP TABLE learners (id uuid);
         CREATE TEMP TABLE story_plan_chapters (
           id uuid, learner_id uuid, period_key text
         );
         CREATE TEMP TABLE learner_reward_grants (
           story_plan_chapter_id uuid, kind text
         );`,
      );
      await client.query(
        `INSERT INTO pg_temp.story_plan_chapters (id, learner_id, period_key)
         VALUES ($1, $2, $3)`,
        [fakeChapterId, learner.id, `story-shadow-period-${suffix}`],
      );
      await client.query(
        `INSERT INTO pg_temp.learner_reward_grants (story_plan_chapter_id, kind)
         VALUES ($1, 'story_chapter')`,
        [fakeChapterId],
      );
      await assert.rejects(
        client.query(
          `UPDATE public.story_collectible_schedules
           SET reconciled_at = now()
           WHERE learner_id = $1`,
          [learner.id],
        ),
        (error) => postgresViolation(error, "23514"),
      );
      await assert.rejects(
        client.query(
          `DELETE FROM public.story_collectible_schedules
           WHERE learner_id = $1`,
          [learner.id],
        ),
        (error) => postgresViolation(error, "23514"),
      );

      const nonConfigurationFact = await client.query(
        `INSERT INTO public.learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata
         ) VALUES ($1, $2, $3, 'learning_item.completed', $4, $5,
           '2026-08-31T13:00:00Z', '{}')
         RETURNING id, created_at`,
        [
          integration.id,
          learner.id,
          nonConfigurationEvent!.id,
          `story-shadow-item-fact-${suffix}`,
          `story-shadow-forged-period-${suffix}`,
        ],
      );
      await client.query(
        `CREATE TEMP TABLE learner_facts (
           id uuid, learner_id uuid, event_type text, period_key text,
           metadata jsonb, created_at timestamp with time zone
         );`,
      );
      await client.query(
        `INSERT INTO pg_temp.learner_facts (
           id, learner_id, event_type, period_key, metadata, created_at
         ) VALUES ($1, $2, 'daily_log_week.configured', $3, $4, $5)`,
        [
          nonConfigurationFact.rows[0].id,
          learner.id,
          `story-shadow-forged-period-${suffix}`,
          calendar,
          nonConfigurationFact.rows[0].created_at,
        ],
      );
      await assert.rejects(
        client.query(
          `INSERT INTO public.story_collectible_schedules (
             learner_id, period_key, source_fact_id, due_at, created_at
           ) VALUES ($1, $2, $3, '2026-09-05T04:00:00Z', $4)`,
          [
            learner.id,
            `story-shadow-forged-period-${suffix}`,
            nonConfigurationFact.rows[0].id,
            nonConfigurationFact.rows[0].created_at,
          ],
        ),
        (error) => postgresViolation(error, "23514"),
      );

      assert.ok(validFact.rows[0].id);
    } finally {
      await client.query("DISCARD TEMP").catch(() => undefined);
      client.release();
      await db.delete(integrations).where(eq(integrations.id, integration.id));
    }
  },
);

test(
  "typed story scheduling is timezone-safe and rejects malformed calendar facts",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const db = getDb();
    const suffix = crypto.randomUUID();
    const [integration] = await db.insert(integrations).values({
      slug: `story-calendar-${suffix}`,
      name: "Story Calendar",
      secretHash: `story-calendar-secret-${suffix}`,
      allowedEventTypes: [],
    }).returning({ id: integrations.id });
    try {
      const scenarios = [
        {
          name: "legacy-midweek-start",
          metadata: {
            term_token: `legacy-midweek-start-${suffix}`,
            term_start_day: "2026-09-02",
            term_end_day: "2026-12-18",
            term_timezone: "America/Toronto",
            week_index: 1,
          },
          expected: "2026-09-05T04:00:00.000Z",
        },
        {
          name: "weekend",
          metadata: {
            term_token: `weekend-${suffix}`,
            term_start_day: "2026-09-06",
            term_end_day: "2026-10-16",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_start_day: "2026-09-06",
            week_index: 1,
          },
          expected: "2026-09-12T04:00:00.000Z",
        },
        {
          name: "dst",
          metadata: {
            term_token: `dst-${suffix}`,
            term_start_day: "2026-03-02",
            term_end_day: "2026-06-19",
            term_timezone: "America/New_York",
            term_week_count: 16,
            week_start_day: "2026-03-09",
            week_index: 2,
          },
          expected: "2026-03-14T04:00:00.000Z",
        },
        {
          name: "midweek-end",
          metadata: {
            term_token: `midweek-end-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-07",
            term_timezone: "Pacific/Kiritimati",
            term_week_count: 6,
            week_start_day: "2026-10-05",
            week_index: 6,
          },
          expected: "2026-10-07T10:00:00.000Z",
        },
      ] as const;
      for (const scenario of scenarios) {
        const [learner] = await db.insert(learners).values({
          integrationId: integration.id,
          externalLearnerId: `story-calendar-${scenario.name}-${suffix}`,
        }).returning({ id: learners.id });
        const [sourceEvent] = await db.insert(events).values({
          integrationId: integration.id,
          learnerId: learner.id,
          idempotencyKey: `story-calendar-${scenario.name}-${suffix}`,
          eventType: "daily_log_week.configured",
          occurredAt: new Date("2026-03-01T12:00:00.000Z"),
          metadata: {},
        }).returning({ id: events.id });
        await db.insert(learnerFacts).values({
          integrationId: integration.id,
          learnerId: learner.id,
          sourceEventId: sourceEvent.id,
          eventType: "daily_log_week.configured",
          semanticKey: `story-calendar-${scenario.name}-${suffix}:1`,
          periodKey: `story-calendar-${scenario.name}-${suffix}`,
          occurredAt: new Date("2026-03-01T12:00:00.000Z"),
          metadata: scenario.metadata,
        });
        const [schedule] = await db.select().from(storyCollectibleSchedules)
          .where(eq(storyCollectibleSchedules.learnerId, learner.id));
        assert.equal(schedule!.dueAt.toISOString(), scenario.expected);
      }

      const [decimalLearner] = await db.insert(learners).values({
        integrationId: integration.id,
        externalLearnerId: `story-calendar-integral-decimal-${suffix}`,
      }).returning({ id: learners.id });
      const [decimalEvent] = await db.insert(events).values({
        integrationId: integration.id,
        learnerId: decimalLearner.id,
        idempotencyKey: `story-calendar-integral-decimal-${suffix}`,
        eventType: "daily_log_week.configured",
        occurredAt: new Date(),
        metadata: {},
      }).returning({ id: events.id });
      const decimalMetadata = `{
        "term_token": ${JSON.stringify(`integral-decimal-${suffix}`)},
        "term_start_day": "2026-08-31",
        "term_end_day": "2026-10-09",
        "term_timezone": "America/Toronto",
        "term_week_count": 6.0,
        "week_start_day": "2026-08-31",
        "week_index": 1.0
      }`;
      await db.execute(sql`
        INSERT INTO public.learner_facts (
          integration_id, learner_id, source_event_id, event_type, semantic_key,
          period_key, occurred_at, metadata
        ) VALUES (
          ${integration.id}, ${decimalLearner.id}, ${decimalEvent.id},
          'daily_log_week.configured', ${`story-calendar-integral-decimal-${suffix}:1`},
          ${`story-calendar-integral-decimal-${suffix}`}, now(),
          ${decimalMetadata}::jsonb
        )
      `);
      const [decimalSchedule] = await db.select().from(storyCollectibleSchedules)
        .where(eq(storyCollectibleSchedules.learnerId, decimalLearner.id));
      assert.equal(
        decimalSchedule?.dueAt.toISOString(),
        "2026-09-05T04:00:00.000Z",
      );

      const invalidScenarios = [
        {
          name: "malformed-date-and-timezone",
          metadata: {
            term_token: `malformed-${suffix}`,
            term_start_day: "2026-99-99",
            term_end_day: "2026-10-09",
            term_timezone: "Not/A_Timezone",
            week_index: 1,
          },
        },
        {
          name: "legacy-week-out-of-range",
          metadata: {
            term_token: `legacy-range-${suffix}`,
            term_start_day: "2026-01-05",
            term_end_day: "2026-05-01",
            term_timezone: "America/Toronto",
            week_index: 17,
          },
        },
        {
          name: "unknown-timezone",
          metadata: {
            term_token: `unknown-timezone-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "Definitely/Not_A_Zone",
            term_week_count: 6,
            week_start_day: "2026-08-31",
            week_index: 1,
          },
        },
        {
          name: "adaptive-week-out-of-range",
          metadata: {
            term_token: `adaptive-range-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_start_day: "2026-10-12",
            week_index: 7,
          },
        },
        {
          name: "adaptive-count-without-start",
          metadata: {
            term_token: `adaptive-missing-start-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_index: 1,
          },
        },
        {
          name: "adaptive-start-without-count",
          metadata: {
            term_token: `adaptive-missing-count-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            week_start_day: "2026-08-31",
            week_index: 1,
          },
        },
        {
          name: "adaptive-week-position-mismatch",
          metadata: {
            term_token: `adaptive-position-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_start_day: "2026-08-31",
            week_index: 6,
          },
        },
        {
          name: "fractional-week-index",
          metadata: {
            term_token: `fractional-index-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_start_day: "2026-08-31",
            week_index: 1.5,
          },
        },
        {
          name: "fractional-week-count",
          metadata: {
            term_token: `fractional-count-${suffix}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6.5,
            week_start_day: "2026-08-31",
            week_index: 1,
          },
        },
      ] as const;
      for (const scenario of invalidScenarios) {
        const [invalidLearner] = await db.insert(learners).values({
          integrationId: integration.id,
          externalLearnerId: `story-calendar-invalid-${scenario.name}-${suffix}`,
        }).returning({ id: learners.id });
        const [invalidEvent] = await db.insert(events).values({
          integrationId: integration.id,
          learnerId: invalidLearner.id,
          idempotencyKey: `story-calendar-invalid-${scenario.name}-${suffix}`,
          eventType: "daily_log_week.configured",
          occurredAt: new Date(),
          metadata: {},
        }).returning({ id: events.id });
        await assert.rejects(
          db.insert(learnerFacts).values({
            integrationId: integration.id,
            learnerId: invalidLearner.id,
            sourceEventId: invalidEvent.id,
            eventType: "daily_log_week.configured",
            semanticKey: `story-calendar-invalid-${scenario.name}-${suffix}:1`,
            periodKey: `story-calendar-invalid-${scenario.name}-${suffix}`,
            occurredAt: new Date(),
            metadata: scenario.metadata,
          }),
          (error) => postgresViolation(error, "23514"),
        );
      }
    } finally {
      await db.delete(integrations).where(eq(integrations.id, integration.id));
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
