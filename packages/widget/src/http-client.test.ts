import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureSnapshot } from "./fixture-client";
import { createPalHttpClient } from "./http-client";

test("HTTP client keeps the integration secret out and uses a learner token", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const client = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    getAccessToken: async () => "short-lived-reader-token",
    fetchImplementation: async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response(JSON.stringify(createFixtureSnapshot()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const snapshot = await client.getSnapshot();
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(
    snapshot.companion.assetUrl,
    "https://pal.example/assets/pets/default.png",
  );
  assert.equal(requests[0]?.input, "https://pal.example/api/v1/learner/snapshot");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("authorization"),
    "Bearer short-lived-reader-token",
  );
});

test("HTTP client rejects an empty learner token before making a request", async () => {
  let called = false;
  const client = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    getAccessToken: async () => "",
    fetchImplementation: async () => {
      called = true;
      return new Response(null, { status: 200 });
    },
  });

  await assert.rejects(() => client.getSnapshot(), /access token was empty/i);
  assert.equal(called, false);
});

test("HTTP client rejects insecure remote API origins at construction", () => {
  assert.throws(
    () =>
      createPalHttpClient({
        apiBaseUrl: "http://pal.example",
        getAccessToken: async () => "learner-token",
      }),
    /must use HTTPS/i,
  );
});

test("HTTP client permits HTTP only for credential-free local development", async () => {
  let requestedUrl = "";
  const client = createPalHttpClient({
    apiBaseUrl: "http://localhost:3000",
    getAccessToken: async () => "learner-token",
    fetchImplementation: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(createFixtureSnapshot()));
    },
  });

  await client.getSnapshot();
  assert.equal(requestedUrl, "http://localhost:3000/api/v1/learner/snapshot");
});

test("HTTP client rejects cross-origin endpoint overrides before acquiring a token", async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const snapshotClient = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    snapshotPath: "https://attacker.example/capture",
    getAccessToken: async () => {
      tokenCalls += 1;
      return "learner-token";
    },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(createFixtureSnapshot()));
    },
  });
  const rewardClient = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    rewardSeenPath: () => "//attacker.example/capture",
    getAccessToken: async () => {
      tokenCalls += 1;
      return "learner-token";
    },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    },
  });

  await assert.rejects(() => snapshotClient.getSnapshot(), /configured API origin/i);
  await assert.rejects(
    () => rewardClient.markRewardSeen("reward-1"),
    /configured API origin/i,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("aborting token acquisition prevents a stale request from reaching fetch", async () => {
  let resolveToken!: (token: string) => void;
  const token = new Promise<string>((resolve) => {
    resolveToken = resolve;
  });
  let fetchCalls = 0;
  let receivedSignal: AbortSignal | undefined;
  const client = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    getAccessToken: (signal) => {
      receivedSignal = signal;
      return token;
    },
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(createFixtureSnapshot()));
    },
  });
  const controller = new AbortController();

  const request = client.getSnapshot(controller.signal);
  controller.abort();

  await assert.rejects(request, (error: unknown) => {
    return error instanceof Error && error.name === "AbortError";
  });
  assert.equal(receivedSignal, controller.signal);
  resolveToken("token-for-a-different-learner");
  await Promise.resolve();
  assert.equal(fetchCalls, 0);
});

test("reward acknowledgement retries use the same learner-scoped endpoint", async () => {
  const requests: string[] = [];
  const client = createPalHttpClient({
    apiBaseUrl: "https://pal.example",
    getAccessToken: async () => "learner-token",
    fetchImplementation: async (input) => {
      requests.push(String(input));
      return new Response(null, { status: 204 });
    },
  });

  await client.markRewardSeen("reward/with spaces");
  await client.markRewardSeen("reward/with spaces");

  assert.deepEqual(requests, [
    "https://pal.example/api/v1/learner/rewards/reward%2Fwith%20spaces/seen",
    "https://pal.example/api/v1/learner/rewards/reward%2Fwith%20spaces/seen",
  ]);
});
