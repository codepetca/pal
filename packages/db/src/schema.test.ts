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

after(async () => {
  if (openedDatabase) await getPool().end();
});
