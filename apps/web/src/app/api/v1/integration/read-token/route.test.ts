import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { getPool } from "@pal/db";
import { resetLearnerInDb } from "@/lib/db-learner";
import { resolveIntegration } from "@/lib/integration-auth";
import { verifyPalReadToken } from "@/lib/read-token";
import { POST } from "./route";

const secret = "pika-route-test-integration-secret-at-least-32-characters";
const sandboxSecret =
  "sandbox-route-test-integration-secret-at-least-32-characters";
process.env.PAL_INTEGRATION_SECRET = secret;
process.env.SANDBOX_INTEGRATION_SECRET = sandboxSecret;
process.env.PAL_READ_TOKEN_SIGNING_SECRET =
  "pika-route-test-signing-secret-at-least-32-characters";

let openedDatabase = false;

function request(body: unknown, authorization = `Bearer ${secret}`): NextRequest {
  return new NextRequest("http://localhost/api/v1/integration/read-token", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("rejects missing integration authentication", async () => {
  const response = await POST(request(
    { learner_id: "pika-learner-safe-token" },
    "Bearer incorrect-integration-secret-with-enough-characters",
  ));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "unauthorized");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects invalid learner data before opening the database", async () => {
  const response = await POST(request({
    learner_id: "raw student@example.com",
    name: "must not cross the boundary",
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "invalid_learner_id");
  assert.equal(openedDatabase, false);
});

test(
  "mints a token scoped to the authenticated integration and learner identity",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `pika-learner-${crypto.randomUUID()}`;
    const configured = {
      slug: "pika" as const,
      name: "Pika",
      secret,
    };

    const response = await POST(request({ learner_id: externalLearnerId }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as {
      token: string;
      expires_at: string;
    };
    assert.deepEqual(Object.keys(body).sort(), ["expires_at", "token"]);
    const claims = await verifyPalReadToken(body.token, "learner:read");
    const integration = await resolveIntegration(configured);
    assert.equal(claims.integrationId, integration.id);
    assert.notEqual(claims.learnerId, externalLearnerId);
    assert.ok(Date.parse(body.expires_at) > Date.now());

    await resetLearnerInDb(integration.id, externalLearnerId);
  },
);

test(
  "isolates the same external learner token between integrations",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const externalLearnerId = `shared-opaque-${crypto.randomUUID()}`;
    const pikaResponse = await POST(request({ learner_id: externalLearnerId }));
    const sandboxResponse = await POST(
      request(
        { learner_id: externalLearnerId },
        `Bearer ${sandboxSecret}`,
      ),
    );
    assert.equal(pikaResponse.status, 200);
    assert.equal(sandboxResponse.status, 200);

    const pikaClaims = await verifyPalReadToken(
      ((await pikaResponse.json()) as { token: string }).token,
      "learner:read",
    );
    const sandboxClaims = await verifyPalReadToken(
      ((await sandboxResponse.json()) as { token: string }).token,
      "learner:read",
    );
    assert.notEqual(pikaClaims.integrationId, sandboxClaims.integrationId);
    assert.notEqual(pikaClaims.learnerId, sandboxClaims.learnerId);

    await resetLearnerInDb(pikaClaims.integrationId, externalLearnerId);
    await resetLearnerInDb(sandboxClaims.integrationId, externalLearnerId);
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
