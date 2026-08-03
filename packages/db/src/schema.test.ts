import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import {
  achievementInstances,
  achievementPeriods,
  events,
  integrations,
  learnerFacts,
  learners,
  rewardNotices,
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

      const [periodA] = await db
        .insert(achievementPeriods)
        .values({
          learnerId: learnerA.id,
          periodKey: "week-a",
          anchorAt: new Date(),
        })
        .returning({ periodKey: achievementPeriods.periodKey });

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

after(async () => {
  if (openedDatabase) await getPool().end();
});
