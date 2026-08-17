import assert from "node:assert/strict";
import test from "node:test";

import { authorizeCronRequest } from "@/lib/cron-auth";

const secret = "story_scheduler_test_secret_1234567890";

test("cron authorization fails closed on missing or malformed deployment config", () => {
  assert.equal(
    authorizeCronRequest(`Bearer ${secret}`, undefined),
    "configuration_error",
  );
  assert.equal(
    authorizeCronRequest("Bearer short", "short"),
    "configuration_error",
  );
  assert.equal(
    authorizeCronRequest(`Bearer ${secret}`, `${secret}\n`),
    "configuration_error",
  );
});

test("cron authorization requires the exact bearer credential", () => {
  assert.equal(authorizeCronRequest(null, secret), "unauthorized");
  assert.equal(authorizeCronRequest(secret, secret), "unauthorized");
  assert.equal(
    authorizeCronRequest(`Bearer ${secret}x`, secret),
    "unauthorized",
  );
  assert.equal(
    authorizeCronRequest(`Bearer ${secret}`, secret),
    "authorized",
  );
});
