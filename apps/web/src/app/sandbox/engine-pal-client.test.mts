import assert from "node:assert/strict";
import test from "node:test";

import { createEnginePalClient } from "./engine-pal-client";

type RecordedRequest = {
  body: Record<string, unknown>;
  path: string;
};

function sessionResponse({
  mood = "neutral",
  session = "session-token",
  xp = 0,
}: {
  mood?: string;
  session?: string;
  xp?: number;
} = {}) {
  return new Response(
    JSON.stringify({
      session,
      world: {
        pet: {
          mood,
          mood_expires_at:
            mood === "neutral" ? null : "2099-01-01T00:00:00.000Z",
          animation_state: "idle",
        },
        world: { stage: 1, objects: [] },
        economy: { xp, xp_lifetime: xp, level: 1, streak: 0 },
      },
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
    return sessionResponse();
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
    return sessionResponse();
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
  const eventBodies: Array<{
    event: Record<string, unknown>;
    session: string;
  }> = [];
  const restore = installFetch((path, init) => {
    if (path === "/api/sandbox/events") {
      eventBodies.push(
        JSON.parse(String(init?.body)) as {
          event: Record<string, unknown>;
          session: string;
        },
      );
      return sessionResponse({ session: "advanced-session" });
    }
    return sessionResponse({ session: "reset-session" });
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    client.dispatch("on-time-finish");
    await client.getSnapshot();
    client.dispatch("duplicate-replayed");
    await client.getSnapshot();
    assert.equal(eventBodies.length, 2);
    assert.deepEqual(eventBodies[1]!.event, eventBodies[0]!.event);
    assert.equal(eventBodies[0]!.session, "reset-session");
    assert.equal(eventBodies[1]!.session, "advanced-session");
  } finally {
    restore();
  }
});

test("two clients keep their learner requests isolated", async () => {
  const learnerIds = new Set<string>();
  const restore = installFetch((path, init) => {
    if (init?.body) {
      const body = JSON.parse(String(init.body)) as {
        learner_id?: string;
        event?: { learner_id?: string };
      };
      const learnerId = body.learner_id ?? body.event?.learner_id;
      if (learnerId) learnerIds.add(learnerId);
    }
    return sessionResponse();
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
    return sessionResponse();
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

test("an event response drives the companion without a process-local world read", async () => {
  const paths: string[] = [];
  const restore = installFetch((path) => {
    paths.push(path);
    return path === "/api/sandbox/events"
      ? sessionResponse({ mood: "happy", session: "advanced", xp: 150 })
      : sessionResponse({ session: "reset" });
  });

  try {
    const client = createEnginePalClient({ learnerId: "learner-a" });
    client.dispatch("on-time-finish");
    const snapshot = await client.getSnapshot();

    assert.equal(snapshot.companion.mood, "happy");
    assert.match(snapshot.companion.message, /150 of 500 XP/);
    assert.deepEqual(paths, ["/api/sandbox/reset", "/api/sandbox/events"]);
  } finally {
    restore();
  }
});
