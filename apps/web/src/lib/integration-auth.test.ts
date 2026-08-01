import assert from "node:assert/strict";
import test from "node:test";
import { identifyIntegration } from "./integration-auth";

const pikaSecret = "pika-integration-test-secret-at-least-32-characters";
const sandboxSecret = "sandbox-integration-test-secret-at-least-32-characters";

process.env.PAL_INTEGRATION_SECRET = pikaSecret;
process.env.SANDBOX_INTEGRATION_SECRET = sandboxSecret;

test("identifies Pika and sandbox as separate integration tenants", () => {
  assert.equal(
    identifyIntegration(`Bearer ${pikaSecret}`)?.slug,
    "pika",
  );
  assert.equal(
    identifyIntegration(`Bearer ${sandboxSecret}`)?.slug,
    "sandbox",
  );
});

test("rejects malformed and unknown bearer credentials", () => {
  for (const header of [
    null,
    "",
    pikaSecret,
    `Basic ${pikaSecret}`,
    `Bearer  ${pikaSecret}`,
    "Bearer unknown-secret-that-does-not-match-any-configured-integration",
  ]) {
    assert.equal(identifyIntegration(header), null);
  }
});
