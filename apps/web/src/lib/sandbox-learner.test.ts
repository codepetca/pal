import assert from "node:assert/strict";
import test from "node:test";
import {
  isSandboxLearnerId,
  isPersistedSandboxRuntimeAllowed,
  isSandboxPageAllowed,
} from "./sandbox-learner";

test("accepts only unguessable browser-session sandbox learner IDs", () => {
  assert.equal(
    isSandboxLearnerId("sandbox-00000000-0000-4000-8000-000000000001"),
    true,
  );
  assert.equal(isSandboxLearnerId("sandbox-student-1"), false);
  assert.equal(isSandboxLearnerId("00000000-0000-4000-8000-000000000001"), false);
});

test("allows the public fixture page in previews but never in production", () => {
  assert.equal(
    isSandboxPageAllowed({ NODE_ENV: "development", VERCEL_ENV: undefined }),
    true,
  );
  assert.equal(
    isSandboxPageAllowed({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
    }),
    true,
  );
  assert.equal(
    isSandboxPageAllowed({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    false,
  );
});

test("persisted sandbox APIs are local-only", () => {
  assert.equal(
    isPersistedSandboxRuntimeAllowed({
      NODE_ENV: "development",
      VERCEL_ENV: undefined,
    }),
    true,
  );
  for (const vercelEnv of ["preview", "production", "unexpected"]) {
    assert.equal(
      isPersistedSandboxRuntimeAllowed({
        NODE_ENV: "production",
        VERCEL_ENV: vercelEnv,
      }),
      false,
    );
  }
  assert.equal(
    isPersistedSandboxRuntimeAllowed({
      NODE_ENV: "production",
      VERCEL_ENV: undefined,
    }),
    false,
  );
});
