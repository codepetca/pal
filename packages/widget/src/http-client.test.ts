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
