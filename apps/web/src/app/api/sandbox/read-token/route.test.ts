import assert from "node:assert/strict";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { getDb, getPool } from "@pal/db";
import {
  getOrCreateLearnerIdentity,
  resetLearnerInDb,
} from "@/lib/db-learner";
import { resolveSandboxIntegration } from "@/lib/integration-auth";
import { verifyPalReadToken } from "@/lib/read-token";
import { POST } from "./route";

const sandboxSecret = "sandbox-token-route-secret-at-least-32-characters";
const signingSecret = "sandbox-token-signing-secret-at-least-32-characters";
process.env.SANDBOX_INTEGRATION_SECRET = sandboxSecret;
process.env.PAL_READ_TOKEN_SIGNING_SECRET = signingSecret;

let openedDatabase = false;

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/sandbox/read-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("rejects non-sandbox learner identities before persistence", async () => {
  const response = await POST(request({ learner_id: "student-1" }));
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test(
  "mints a sandbox-integration token for exactly one browser learner",
  { skip: !process.env.DATABASE_URL },
  async () => {
    openedDatabase = true;
    const learnerId = `sandbox-${crypto.randomUUID()}`;
    const integration = await resolveSandboxIntegration();
    try {
      const response = await POST(request({ learner_id: learnerId }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = (await response.json()) as {
        token: string;
        expires_at: string;
      };
      const claims = await verifyPalReadToken(body.token, "learner:read");
      const internalLearnerId = await getOrCreateLearnerIdentity(
        getDb(),
        integration.id,
        learnerId,
      );
      assert.equal(claims.integrationId, integration.id);
      assert.equal(claims.learnerId, internalLearnerId);
      assert.equal(claims.scopes.has("reward:ack"), true);
      assert.ok(Date.parse(body.expires_at) > Date.now());
    } finally {
      await resetLearnerInDb(integration.id, learnerId);
    }
  },
);

after(async () => {
  if (openedDatabase) await getPool().end();
});
