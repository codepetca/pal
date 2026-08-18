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
import { runStoryGrantWorker } from "@/lib/story-grant-worker";
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
      assert.equal(snapshot.rewards.length, 2);

      for (const reward of snapshot.rewards) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const acknowledged = await acknowledgeReward(
            request(
              `/api/v1/learner/rewards/${reward.id}/seen`,
              token,
              allowedOrigin,
              "POST",
            ),
            { params: Promise.resolve({ rewardId: reward.id }) },
          );
          assert.equal(acknowledged.status, 204);
        }
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
  "snapshot capability header opts schema-v1 clients into sketch collectibles",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `routes-sketch-${crypto.randomUUID()}`;
    const periodKey = `routes-sketch-period-${crypto.randomUUID()}`;
    const termKey = `routes-sketch-term-${crypto.randomUUID()}`;
    const integration = await resolveIntegration({
      slug: "sandbox",
      name: "Sandbox",
      secret,
    });
    try {
      const configured = await processEventInDb(
        integration.id,
        externalLearnerId,
        {
          event_type: "daily_log_week.configured",
          occurred_at: "2026-08-17T12:00:00.000Z",
          metadata: {
            period_key: periodKey,
            config_version: 1,
            period_status: "open",
            eligible_days: 1,
            term_token: termKey,
            term_start_day: "2026-08-17",
            term_end_day: "2026-09-25",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_start_day: "2026-08-17",
            week_index: 1,
          },
        },
        `routes-sketch-${crypto.randomUUID()}`,
        { storyGrantAsOf: new Date("2026-08-17T00:00:00.000Z") },
      );
      assert.equal(configured.status, "processed");
      const learnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        externalLearnerId,
      );
      const worker = await runStoryGrantWorker({
        asOf: new Date("2026-08-22T12:00:00.000Z"),
        onlyLearnerIds: [learnerId],
      });
      assert.equal(worker.grants, 1);
      const { token } = await mintPalReadToken({
        learnerId,
        integrationId: integration.id,
      });

      const legacyResponse = await getSnapshot(
        request("/api/v1/learner/snapshot", token, allowedOrigin),
      );
      const legacy = (await legacyResponse.json()) as {
        progression?: { collectibles: Array<{ status: string }> };
        rewards: Array<{ kind?: string }>;
      };
      assert.equal(
        legacy.progression?.collectibles.some(
          (collectible) => collectible.status === "earned",
        ),
        false,
      );
      assert.equal(legacy.rewards.some((reward) => reward.kind === "story"), false);

      const capableRequest = request(
        "/api/v1/learner/snapshot",
        token,
        allowedOrigin,
      );
      capableRequest.headers.set("X-Pal-Collectible-Finish", "1");
      const capableResponse = await getSnapshot(capableRequest);
      const capable = (await capableResponse.json()) as {
        progression?: {
          collectibles: Array<{ status: string; finish?: string }>;
        };
        rewards: Array<{ kind?: string; collectibleFinish?: string }>;
      };
      assert.equal(
        capable.progression?.collectibles.some(
          (collectible) =>
            collectible.status === "earned" && collectible.finish === "sketch",
        ),
        true,
      );
      assert.equal(
        capable.rewards.some(
          (reward) =>
            reward.kind === "story" && reward.collectibleFinish === "sketch",
        ),
        true,
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
