import assert from "node:assert/strict";
import test from "node:test";

import {
  applySandboxEvent,
  createSandboxSession,
  InvalidSandboxSessionError,
} from "./sandbox-session";

const SECRET = "test-only-sandbox-secret";
const LEARNER_ID = "sandbox-session-a";
const OCCURRED_AT = "2026-07-31T12:00:00.000Z";
const NOW = Date.parse(OCCURRED_AT);

const request = {
  idempotencyKey: "event-1",
  learnerId: LEARNER_ID,
  event: {
    event_type: "learning_item.completed",
    occurred_at: OCCURRED_AT,
    metadata: { on_time: true },
  },
};

test("a signed sandbox session carries engine state across invocations", () => {
  const reset = createSandboxSession(LEARNER_ID, SECRET, NOW);
  const processed = applySandboxEvent(reset.session, request, SECRET, NOW);

  assert.equal(processed.status, "processed");
  assert.equal(processed.world.pet.mood, "happy");
  assert.equal(processed.world.economy.xp, 150);
  assert.notEqual(processed.session, reset.session);

  const duplicate = applySandboxEvent(
    processed.session,
    request,
    SECRET,
    NOW,
  );
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.world.economy.xp, 150);
  assert.equal(duplicate.session, processed.session);
});

test("a sandbox session cannot be modified or moved to another learner", () => {
  const reset = createSandboxSession(LEARNER_ID, SECRET, NOW);
  const replacement = reset.session.endsWith("a") ? "b" : "a";
  const tampered = reset.session.slice(0, -1) + replacement;

  assert.throws(
    () => applySandboxEvent(tampered, request, SECRET, NOW),
    InvalidSandboxSessionError,
  );
  assert.throws(
    () =>
      applySandboxEvent(
        reset.session,
        { ...request, learnerId: "sandbox-session-b" },
        SECRET,
        NOW,
      ),
    /does not match session/,
  );
});

test("a signed mood expires without another server mutation", () => {
  const reset = createSandboxSession(LEARNER_ID, SECRET, NOW);
  const processed = applySandboxEvent(reset.session, request, SECRET, NOW);
  const afterWindow = applySandboxEvent(
    processed.session,
    { ...request, idempotencyKey: "event-1" },
    SECRET,
    NOW + 31 * 60_000,
  );

  assert.equal(afterWindow.status, "duplicate");
  assert.equal(afterWindow.world.pet.mood, "neutral");
  assert.equal(afterWindow.world.economy.xp, 150);
});
