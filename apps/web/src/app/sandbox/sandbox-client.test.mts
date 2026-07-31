import assert from "node:assert/strict";
import test from "node:test";
import { createFixturePalClient } from "@codepet/pal-widget";
import { createSandboxPalClient } from "./sandbox-client";

function withFetch(
  implementation: typeof fetch,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("surfaces persisted-state failures instead of falling back to fixtures", async () => {
  await withFetch(
    async () => new Response(null, { status: 500 }),
    async () => {
      const client = createSandboxPalClient(
        createFixturePalClient(),
        "sandbox-00000000-0000-4000-8000-000000000001",
      );
      await assert.rejects(
        () => client.getSnapshot(),
        /could not load persisted sandbox state \(500\)/i,
      );
    },
  );
});

test("treats an unknown session learner as a neutral level-one companion", async () => {
  await withFetch(
    async () => new Response(null, { status: 404 }),
    async () => {
      const client = createSandboxPalClient(
        createFixturePalClient(),
        "sandbox-00000000-0000-4000-8000-000000000002",
      );
      const snapshot = await client.getSnapshot();
      assert.equal(snapshot.companion.mood, "neutral");
      assert.equal(snapshot.companion.level, 1);
      assert.equal(snapshot.companion.xp, 0);
    },
  );
});

test("scopes persisted reads to each browser learner", async () => {
  const paths: string[] = [];
  await withFetch(
    async (input) => {
      paths.push(String(input));
      return new Response(null, { status: 404 });
    },
    async () => {
      const first = createSandboxPalClient(
        createFixturePalClient(),
        "sandbox-00000000-0000-4000-8000-000000000003",
      );
      const second = createSandboxPalClient(
        createFixturePalClient(),
        "sandbox-00000000-0000-4000-8000-000000000004",
      );
      await Promise.all([first.getSnapshot(), second.getSnapshot()]);
    },
  );

  assert.deepEqual(paths, [
    "/api/v1/world/sandbox-00000000-0000-4000-8000-000000000003",
    "/api/v1/world/sandbox-00000000-0000-4000-8000-000000000004",
  ]);
});
