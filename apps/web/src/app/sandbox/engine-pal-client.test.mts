import assert from "node:assert/strict";
import test from "node:test";

import { createEnginePalClient } from "./engine-pal-client";

type RecordedRequest = {
  body: Record<string, unknown>;
  path: string;
};

function worldResponse() {
  return new Response(
    JSON.stringify({
      pet: { mood: "neutral", animation_state: "idle" },
      world: { stage: 1, objects: [] },
      economy: { xp: 0, xp_lifetime: 0, level: 1, streak: 0 },
    }),
    { status: 200 },
  );
}

function installFetch(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("replay is a no-op before the first event and after reset", async () => {
  const requests: RecordedRequest[] = [];
  const restore = installFetch((path, init) => {
    if (init?.body) {
      requests.push({
        path,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
      });
    }
    return path.startsWith("/api/v1/world/") ? worldResponse() : new Response(null);
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    assert.match(client.dispatch("duplicate-replayed"), /Nothing to replay/);
    await client.getSnapshot();
    assert.equal(
      requests.filter((request) => request.path === "/api/sandbox/events").length,
      0,
    );

    client.dispatch("on-time-finish");
    await client.getSnapshot();
    client.dispatch("reset");
    assert.match(client.dispatch("duplicate-replayed"), /Nothing to replay/);
    await client.getSnapshot();
    assert.equal(
      requests.filter((request) => request.path === "/api/sandbox/events").length,
      1,
    );
  } finally {
    restore();
  }
});

test("reset invalidates an engine event that was already queued", async () => {
  let eventWrites = 0;
  const restore = installFetch((path) => {
    if (path === "/api/sandbox/events") eventWrites += 1;
    return path.startsWith("/api/v1/world/")
      ? worldResponse()
      : new Response(null);
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    client.dispatch("on-time-finish");
    client.dispatch("reset");
    await client.getSnapshot();

    assert.match(client.dispatch("duplicate-replayed"), /Nothing to replay/);
    await client.getSnapshot();
    assert.equal(eventWrites, 1);
  } finally {
    restore();
  }
});

test("replay resends the exact prior engine request", async () => {
  const eventBodies: string[] = [];
  const restore = installFetch((path, init) => {
    if (path === "/api/sandbox/events") eventBodies.push(String(init?.body));
    return path.startsWith("/api/v1/world/") ? worldResponse() : new Response(null);
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    client.dispatch("on-time-finish");
    await client.getSnapshot();
    client.dispatch("duplicate-replayed");
    await client.getSnapshot();
    assert.equal(eventBodies.length, 2);
    assert.equal(eventBodies[1], eventBodies[0]);
  } finally {
    restore();
  }
});

test("two clients keep their learner requests isolated", async () => {
  const learnerIds = new Set<string>();
  const restore = installFetch((path, init) => {
    if (init?.body) {
      const body = JSON.parse(String(init.body)) as { learner_id?: string };
      if (body.learner_id) learnerIds.add(body.learner_id);
    }
    const worldMatch = path.match(/^\/api\/v1\/world\/(.+)$/);
    if (worldMatch) {
      learnerIds.add(worldMatch[1]!);
      return worldResponse();
    }
    return new Response(null);
  });

  try {
    const first = createEnginePalClient({ learnerId: "session-one" });
    const second = createEnginePalClient({ learnerId: "session-two" });
    first.dispatch("daily-log-completed");
    second.dispatch("on-time-finish");
    await Promise.all([first.getSnapshot(), second.getSnapshot()]);
    assert.deepEqual(learnerIds, new Set(["session-one", "session-two"]));
  } finally {
    restore();
  }
});

test("a non-2xx write rejects with a useful surfaced error", async () => {
  const errors: Error[] = [];
  const restore = installFetch(() => new Response(null, { status: 503 }));

  try {
    const client = createEnginePalClient({
      learnerId: "learner-a",
      onWriteError: (error) => errors.push(error),
    });
    await assert.rejects(
      client.getSnapshot(),
      /could not reset the sandbox learner \(503\)/,
    );
    assert.equal(errors.length, 1);
    assert.match(errors[0]!.message, /reset the sandbox learner/);
  } finally {
    restore();
  }
});

test("a failed event write never becomes replayable", async () => {
  let eventWrites = 0;
  const restore = installFetch((path) => {
    if (path === "/api/sandbox/events") {
      eventWrites += 1;
      return new Response(null, { status: 503 });
    }
    return path.startsWith("/api/v1/world/")
      ? worldResponse()
      : new Response(null);
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    client.dispatch("on-time-finish");
    await assert.rejects(client.getSnapshot(), /send the sandbox event \(503\)/);
    assert.match(client.dispatch("duplicate-replayed"), /Nothing to replay/);
    assert.equal(eventWrites, 1);
  } finally {
    restore();
  }
});
