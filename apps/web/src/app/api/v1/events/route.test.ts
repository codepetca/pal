import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  getDb,
  getPool,
  integrations,
  learnerFacts,
  learnerRewardGrants,
  learners,
  storyCollectibleSchedules,
  storyPlans,
} from "@pal/db";
import { v1 } from "@pal/contract";
import { loadLearnerFromDb, resetLearnerInDb } from "@/lib/db-learner";
import {
  resolveIntegration,
  resolveSandboxIntegration,
} from "@/lib/integration-auth";
import { isPlausibleActivityDay } from "@/lib/activity-day";
import { loadLearnerSnapshot } from "@/lib/learner-snapshot";
import { POST } from "./route";

const secret = "route-test-sandbox-secret-at-least-32-characters";
const pikaSecret = "route-test-pika-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = secret;
process.env.PAL_INTEGRATION_SECRET = pikaSecret;

let openedDatabase = false;

function request(body: unknown, bearerSecret = secret): NextRequest {
  return new NextRequest("http://localhost/api/v1/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function learningItemEvent(
  learnerId: string,
  idempotencyKey = `test-${crypto.randomUUID()}`,
) {
  return {
    schema_version: 1,
    idempotency_key: idempotencyKey,
    learner_id: learnerId,
    event_type: "learning_item.completed",
    occurred_at: new Date().toISOString(),
    metadata: {
      item_token: `item-${crypto.randomUUID()}`,
      kind: "assignment",
      period_key: "test-week",
      timing: "on_time",
    },
  };
}

test("rejects metadata outside the privacy allow-list before opening the database", async () => {
  const payload = learningItemEvent(`sandbox-${crypto.randomUUID()}`);
  const response = await POST(request({
    ...payload,
    metadata: { ...payload.metadata, student_name: "must-not-persist" },
  }));

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "invalid_metadata");
  assert.equal(openedDatabase, false);
});

test("rejects an envelope without the declared schema version", async () => {
  const payload: Partial<ReturnType<typeof learningItemEvent>> =
    learningItemEvent(`sandbox-${crypto.randomUUID()}`);
  delete payload.schema_version;
  const response = await POST(request(payload));

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "unsupported_schema_version");
});

test("rejects an implausible activity day before opening the database", async () => {
  const payload = learningItemEvent(`sandbox-${crypto.randomUUID()}`);
  const response = await POST(
    request({
      ...payload,
      event_type: "daily_log.completed",
      metadata: {
        period_key: "future-week",
        activity_day: "2099-01-01",
      },
    }),
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "implausible_activity_day");
  assert.equal(openedDatabase, false);
});

test("rejects a future instant even when clock skew crosses UTC midnight", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-08-14T23:00:00.000Z");
  try {
    const payload = learningItemEvent(`sandbox-${crypto.randomUUID()}`);
    const response = await POST(
      request({
        ...payload,
        occurred_at: "2026-08-15T00:00:01.000Z",
      }),
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "future_occurred_at");
    assert.equal(openedDatabase, false);
  } finally {
    Date.now = originalNow;
  }
});

test("rejects the day after tomorrow near UTC midnight", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-08-14T23:00:00.000Z");
  try {
    const payload = learningItemEvent(`sandbox-${crypto.randomUUID()}`);
    const response = await POST(
      request({
        ...payload,
        event_type: "daily_log.completed",
        occurred_at: "2026-08-14T23:30:00.000Z",
        metadata: {
          period_key: "future-week",
          activity_day: "2026-08-16",
        },
      }),
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "implausible_activity_day");
    assert.equal(openedDatabase, false);
  } finally {
    Date.now = originalNow;
  }
});

test("rejects an activity day inconsistent with its occurred-at instant", async () => {
  const payload = learningItemEvent(`sandbox-${crypto.randomUUID()}`);
  const response = await POST(
    request({
      ...payload,
      event_type: "daily_log.completed",
      metadata: {
        period_key: "historical-week",
        activity_day: "2020-01-01",
      },
    }),
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "implausible_activity_day");
  assert.equal(openedDatabase, false);
});

test("permits legitimate UTC-12 and UTC+14 local-date boundaries", () => {
  assert.equal(
    isPlausibleActivityDay(
      "2026-08-13",
      Date.parse("2026-08-14T00:30:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isPlausibleActivityDay(
      "2026-08-15",
      Date.parse("2026-08-14T23:30:00.000Z"),
    ),
    true,
  );
});

test("rejects year-zero term dates before opening the database", async () => {
  const response = await POST(request({
    schema_version: 1,
    idempotency_key: `year-zero-${crypto.randomUUID()}`,
    learner_id: `sandbox-${crypto.randomUUID()}`,
    event_type: "daily_log_week.configured",
    occurred_at: new Date().toISOString(),
    metadata: {
      period_key: `year-zero-period-${crypto.randomUUID()}`,
      config_version: 1,
      period_status: "open",
      eligible_days: 5,
      term_token: "year-zero-term",
      term_start_day: "0000-01-03",
      term_end_day: "0000-02-11",
      term_timezone: "America/Toronto",
      term_week_count: 6,
      week_start_day: "0000-01-03",
      week_index: 1,
    },
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "invalid_metadata");
  assert.equal(openedDatabase, false);
});

test(
  "rejects a story week ordinal that cannot fit its term range",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `invalid-story-ordinal-${crypto.randomUUID()}`;
    const integration = await resolveSandboxIntegration();
    const db = getDb();
    try {
      const response = await POST(request({
        schema_version: 1,
        idempotency_key: `invalid-story-ordinal-${crypto.randomUUID()}`,
        learner_id: externalLearnerId,
        event_type: "daily_log_week.configured",
        occurred_at: new Date().toISOString(),
        metadata: {
          period_key: `invalid-story-period-${crypto.randomUUID()}`,
          config_version: 1,
          period_status: "open",
          eligible_days: 4,
          term_token: `invalid-story-term-${crypto.randomUUID()}`,
          term_start_day: "2026-04-13",
          term_end_day: "2026-08-02",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_start_day: "2026-04-13",
          week_index: 16,
        },
      }));
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error, "invalid_term_story_schedule");

      const [learner] = await db
        .select({ id: learners.id })
        .from(learners)
        .where(and(
          eq(learners.integrationId, integration.id),
          eq(learners.externalLearnerId, externalLearnerId),
        ))
        .limit(1);
      assert.ok(learner);
      assert.equal(
        (await db.select().from(storyPlans).where(eq(storyPlans.learnerId, learner.id))).length,
        0,
      );
      assert.equal(
        (await db.select().from(learnerRewardGrants).where(eq(learnerRewardGrants.learnerId, learner.id))).length,
        0,
      );
      const snapshot = await loadLearnerSnapshot(integration.id, learner.id, db);
      const raw = JSON.stringify(snapshot);
      assert.equal(raw.includes("Meet Lumi"), false);
      assert.equal(raw.includes("True Friend"), false);
      assert.equal(raw.includes("/assets/pets/lumi-v1.png"), false);
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "canonicalizes contract-valid timezone aliases before scheduling",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const integration = await resolveSandboxIntegration();
    const db = getDb();
    for (const [sourceTimeZone, canonicalTimeZone] of [
      ["america/toronto", "America/Toronto"],
      ["US/Eastern", "America/New_York"],
    ] as const) {
      const externalLearnerId = `timezone-alias-${crypto.randomUUID()}`;
      try {
        const response = await POST(request({
          schema_version: 1,
          idempotency_key: `timezone-alias-${crypto.randomUUID()}`,
          learner_id: externalLearnerId,
          event_type: "daily_log_week.configured",
          occurred_at: new Date().toISOString(),
          metadata: {
            period_key: `timezone-period-${crypto.randomUUID()}`,
            config_version: 1,
            period_status: "open",
            eligible_days: 5,
            term_token: `timezone-term-${crypto.randomUUID()}`,
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: sourceTimeZone,
            term_week_count: 6,
            week_start_day: "2026-08-31",
            week_index: 1,
          },
        }));
        assert.equal(response.status, 200);
        assert.equal((await response.json()).status, "processed");

        const [learner] = await db.select({ id: learners.id }).from(learners)
          .where(and(
            eq(learners.integrationId, integration.id),
            eq(learners.externalLearnerId, externalLearnerId),
          ))
          .limit(1);
        assert.ok(learner);
        const [fact] = await db.select({ metadata: learnerFacts.metadata })
          .from(learnerFacts)
          .where(and(
            eq(learnerFacts.learnerId, learner.id),
            eq(learnerFacts.eventType, "daily_log_week.configured"),
          ))
          .limit(1);
        assert.equal(
          (fact?.metadata as Record<string, unknown>).term_timezone,
          canonicalTimeZone,
        );
        assert.equal(
          (await db.select().from(storyCollectibleSchedules).where(
            eq(storyCollectibleSchedules.learnerId, learner.id),
          )).length,
          1,
        );
      } finally {
        await resetLearnerInDb(integration.id, externalLearnerId);
      }
    }
  },
);

test(
  "persists valid events atomically, deduplicates retries, and serializes concurrent writes",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const learnerId = `sandbox-${crypto.randomUUID()}`;
    const first = learningItemEvent(learnerId);

    try {
      const processed = await POST(request(first));
      assert.equal(processed.status, 200);
      assert.equal((await processed.json()).status, "processed");

      const duplicate = await POST(request(first));
      assert.equal(duplicate.status, 200);
      assert.equal((await duplicate.json()).status, "duplicate");

      const concurrent = await Promise.all([
        POST(request(learningItemEvent(learnerId))),
        POST(request(learningItemEvent(learnerId))),
      ]);
      assert.deepEqual(concurrent.map((response) => response.status), [200, 200]);

      const integration = await resolveSandboxIntegration();
      const state = await loadLearnerFromDb(integration.id, learnerId);
      assert.ok(state);
      assert.equal(state.economy.xp, 300);
      assert.equal(state.economy.xp_lifetime, 300);
      assert.equal(state.economy.level, 1);
    } finally {
      const integration = await resolveSandboxIntegration();
      await resetLearnerInDb(integration.id, learnerId);
    }
  },
);

test(
  "enforces each integration's event allow-list before learner persistence",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const learnerId = `allow-list-${crypto.randomUUID()}`;
    const pikaConfiguration = {
      slug: "pika" as const,
      name: "Pika",
      secret: pikaSecret,
    };
    const pika = await resolveIntegration(pikaConfiguration);
    const db = getDb();

    try {
      await db
        .update(integrations)
        .set({ allowedEventTypes: ["platform.session.started"] })
        .where(eq(integrations.id, pika.id));

      const rejected = await POST(
        request(learningItemEvent(learnerId), pikaSecret),
      );
      assert.equal(rejected.status, 422);
      assert.equal((await rejected.json()).error, "unknown_event_type");
      assert.equal(await loadLearnerFromDb(pika.id, learnerId), null);

      const accepted = await POST(request(learningItemEvent(learnerId)));
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).status, "processed");
      const sandbox = await resolveSandboxIntegration();
      assert.ok(await loadLearnerFromDb(sandbox.id, learnerId));
      await resetLearnerInDb(sandbox.id, learnerId);
    } finally {
      await db
        .update(integrations)
        .set({ allowedEventTypes: [...v1.V1_EVENT_TYPES] })
        .where(eq(integrations.id, pika.id));
      await resetLearnerInDb(pika.id, learnerId);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
