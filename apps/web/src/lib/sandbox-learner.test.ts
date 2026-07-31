import assert from "node:assert/strict";
import test from "node:test";
import { isSandboxLearnerId } from "./sandbox-learner";

test("accepts only browser-scoped sandbox UUIDs", () => {
  assert.equal(
    isSandboxLearnerId("sandbox-00000000-0000-4000-8000-000000000001"),
    true,
  );
  for (const value of [
    "test-learner-001",
    "sandbox-known-name",
    "sandbox-00000000-0000-0000-0000-000000000000",
    "learner-from-another-integration",
    null,
  ]) {
    assert.equal(isSandboxLearnerId(value), false);
  }
});
