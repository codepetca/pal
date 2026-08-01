import assert from "node:assert/strict";
import test from "node:test";
import {
  isSandboxLearnerId,
  isSandboxRuntimeAllowed,
} from "./sandbox-learner";

test("accepts only unguessable browser-session sandbox learner IDs", () => {
  assert.equal(
    isSandboxLearnerId("sandbox-00000000-0000-4000-8000-000000000001"),
    true,
  );
  assert.equal(isSandboxLearnerId("sandbox-student-1"), false);
  assert.equal(isSandboxLearnerId("00000000-0000-4000-8000-000000000001"), false);
});

test("allows sandbox APIs locally and only in explicitly protected previews", () => {
  assert.equal(
    isSandboxRuntimeAllowed({ NODE_ENV: "development", VERCEL_ENV: undefined }),
    true,
  );
  assert.equal(
    isSandboxRuntimeAllowed({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PAL_SANDBOX_PROTECTED_PREVIEW: "true",
    }),
    true,
  );
  for (const value of [undefined, "false", "TRUE", "unexpected"]) {
    assert.equal(
      isSandboxRuntimeAllowed({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        PAL_SANDBOX_PROTECTED_PREVIEW: value,
      }),
      false,
    );
  }
  assert.equal(
    isSandboxRuntimeAllowed({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    false,
  );
  assert.equal(
    isSandboxRuntimeAllowed({ NODE_ENV: "production", VERCEL_ENV: "unexpected" }),
    false,
  );
  assert.equal(
    isSandboxRuntimeAllowed({ NODE_ENV: "production", VERCEL_ENV: undefined }),
    false,
  );
});
