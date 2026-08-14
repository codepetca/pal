import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getPool, integrations } from "@pal/db";
import { v1 } from "@pal/contract";
import { loadLearnerFromDb, resetLearnerInDb } from "@/lib/db-learner";
import {
  resolveIntegration,
  resolveSandboxIntegration,
} from "@/lib/integration-auth";
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

test("rejects a far-future activity day before opening the database", async () => {
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
  assert.equal((await response.json()).error, "future_activity_day");
  assert.equal(openedDatabase, false);
});

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
