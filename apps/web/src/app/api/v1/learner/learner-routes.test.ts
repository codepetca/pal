import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { getDb, getPool } from "@pal/db";
import {
  getOrCreateLearnerIdentity,
  processEventInDb,
  resetLearnerInDb,
} from "@/lib/db-learner";
import { resolveIntegration } from "@/lib/integration-auth";
import { mintPalReadToken } from "@/lib/read-token";
import { GET as getSnapshot, OPTIONS as snapshotOptions } from "./snapshot/route";
import {
  OPTIONS as rewardOptions,
  POST as acknowledgeReward,
} from "./rewards/[rewardId]/seen/route";

const secret = "learner-routes-sandbox-secret-at-least-32-characters";
const pikaSecret = "learner-routes-pika-secret-at-least-32-characters";
const signingSecret = "learner-routes-signing-secret-at-least-32-characters";
const allowedOrigin = "https://pika.example.test";
process.env.SANDBOX_INTEGRATION_SECRET = secret;
process.env.PAL_INTEGRATION_SECRET = pikaSecret;
process.env.PAL_READ_TOKEN_SIGNING_SECRET = signingSecret;
process.env.PAL_ALLOWED_WIDGET_ORIGINS = allowedOrigin;

let openedDatabase = false;

function request(
  path: string,
  token?: string,
  origin?: string,
  method = "GET",
): NextRequest {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (origin) headers.set("Origin", origin);
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

test("rejects missing authentication and unapproved widget origins", async () => {
  const missing = await getSnapshot(request("/api/v1/learner/snapshot"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("cache-control"), "no-store");

  const disallowed = await getSnapshot(
    request(
      "/api/v1/learner/snapshot",
      "untrusted-token",
      "https://attacker.example",
    ),
  );
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get("cache-control"), "no-store");
  assert.equal(disallowed.headers.get("vary"), "Origin");
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

  const deniedRewardPreflight = await rewardOptions(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      undefined,
      "https://attacker.example",
      "OPTIONS",
    ),
  );
  assert.equal(deniedRewardPreflight.status, 403);
  assert.equal(deniedRewardPreflight.headers.get("cache-control"), "no-store");
  assert.equal(deniedRewardPreflight.headers.get("vary"), "Origin");
  assert.equal(
    deniedRewardPreflight.headers.get("access-control-allow-origin"),
    null,
  );

  const deniedReward = await acknowledgeReward(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      "untrusted-token",
      "https://attacker.example",
      "POST",
    ),
    { params: Promise.resolve({ rewardId: "not-a-reward" }) },
  );
  assert.equal(deniedReward.status, 403);
  assert.equal(deniedReward.headers.get("cache-control"), "no-store");
  assert.equal(deniedReward.headers.get("vary"), "Origin");

  const unauthenticatedInvalidReward = await acknowledgeReward(
    request(
      "/api/v1/learner/rewards/not-a-reward/seen",
      "untrusted-token",
      allowedOrigin,
      "POST",
    ),
    { params: Promise.resolve({ rewardId: "not-a-reward" }) },
  );
  assert.equal(unauthenticatedInvalidReward.status, 401);

  const preflight = await snapshotOptions(
    request("/api/v1/learner/snapshot", undefined, allowedOrigin, "OPTIONS"),
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.match(
    preflight.headers.get("access-control-allow-headers") ?? "",
    /Authorization/,
  );
});

test(
  "serves an authenticated snapshot and acknowledges its reward idempotently",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `routes-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      await processEventInDb(
        integration.id,
        externalLearnerId,
        {
          event_type: "learning_item.completed",
          occurred_at: new Date().toISOString(),
          metadata: {
            item_token: `item-${crypto.randomUUID()}`,
            kind: "assignment",
            period_key: `period-${crypto.randomUUID()}`,
            timing: "on_time",
          },
        },
        `routes-${crypto.randomUUID()}`,
      );
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: integration.id,
      });

      const response = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
      const snapshot = (await response.json()) as {
        schemaVersion: number;
        rewards: Array<{ id: string }>;
      };
      assert.equal(snapshot.schemaVersion, 1);
      assert.equal(snapshot.rewards.length, 1);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const acknowledged = await acknowledgeReward(
          request(
            `/api/v1/learner/rewards/${snapshot.rewards[0].id}/seen`,
            token,
            allowedOrigin,
            "POST",
          ),
          { params: Promise.resolve({ rewardId: snapshot.rewards[0].id }) },
        );
        assert.equal(acknowledged.status, 204);
      }

      const afterAck = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(afterAck.status, 200);
      assert.equal(
        ((await afterAck.json()) as { rewards: unknown[] }).rewards.length,
        0,
      );
    } finally {
      await resetLearnerInDb(integration.id, externalLearnerId);
    }
  },
);

test(
  "does not serve a learner through a token naming another integration",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `route-scope-${crypto.randomUUID()}`;
    const sandbox = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    const pika = await resolveIntegration({
      slug: "pika",
      name: "Pika",
      secret: pikaSecret,
    });
    try {
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        sandbox.id,
        externalLearnerId,
      );
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: pika.id,
      });
      const response = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "learner_not_found");
    } finally {
      await resetLearnerInDb(sandbox.id, externalLearnerId);
      await resetLearnerInDb(pika.id, externalLearnerId);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
