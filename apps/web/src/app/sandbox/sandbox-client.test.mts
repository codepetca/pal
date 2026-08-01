import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureSnapshot } from "@codepet/pal-widget";
import { createSandboxPalClient } from "./sandbox-client";

const learnerId = "sandbox-00000000-0000-4000-8000-000000000001";
const apiBaseUrl = "https://pal.example.test";

test("uses one short-lived token for real snapshot and reward requests", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/sandbox/read-token")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { learner_id: learnerId });
      return Response.json({
        token: "learner-token",
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    }
    if (url.endsWith("/api/v1/learner/snapshot")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer learner-token",
      );
      return Response.json(createFixtureSnapshot());
    }
    if (url.includes("/api/v1/learner/rewards/")) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer learner-token",
      );
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected sandbox request: ${url}`);
  };

  const client = createSandboxPalClient(
    learnerId,
    apiBaseUrl,
    fetchImplementation,
  );
  const snapshot = await client.getSnapshot();
  await client.markRewardSeen("00000000-0000-4000-8000-000000000099");

  assert.equal(
    calls.filter((call) => call.url.endsWith("/api/sandbox/read-token")).length,
    1,
  );
  assert.equal(snapshot.schemaVersion, 1);
});

test("invalidating the client token forces a fresh learner exchange", async () => {
  let tokenRequests = 0;
  const fetchImplementation: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/api/sandbox/read-token")) {
      tokenRequests += 1;
      return Response.json({
        token: `learner-token-${tokenRequests}`,
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    }
    return Response.json(createFixtureSnapshot());
  };
  const client = createSandboxPalClient(
    learnerId,
    apiBaseUrl,
    fetchImplementation,
  );

  await client.getSnapshot();
  client.invalidateAccessToken();
  await client.getSnapshot();
  assert.equal(tokenRequests, 2);
});

test("surfaces token exchange failures without fixture fallback", async () => {
  const client = createSandboxPalClient(
    learnerId,
    apiBaseUrl,
    async () => new Response(null, { status: 500 }),
  );
  await assert.rejects(
    () => client.getSnapshot(),
    /could not authorize the sandbox learner \(500\)/i,
  );
});

test("rejects malformed sandbox token responses", async () => {
  const client = createSandboxPalClient(
    learnerId,
    apiBaseUrl,
    async () => Response.json({ token: "missing-expiry" }),
  );
  await assert.rejects(
    () => client.getSnapshot(),
    /invalid sandbox learner token response/i,
  );
});
