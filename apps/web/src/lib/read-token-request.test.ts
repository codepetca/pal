import assert from "node:assert/strict";
import test from "node:test";
import { validateReadTokenRequest } from "./read-token-request";

test("accepts one privacy-safe learner token", () => {
  assert.deepEqual(validateReadTokenRequest({ learner_id: "pika-learner_A.1~" }), {
    ok: true,
    learnerId: "pika-learner_A.1~",
  });
});

test("rejects raw-looking or expanded request data", () => {
  for (const body of [
    null,
    {},
    { learner_id: "" },
    { learner_id: "student@example.com" },
    { learner_id: "student id" },
    { learner_id: "safe-token", name: "Student" },
  ]) {
    assert.equal(validateReadTokenRequest(body).ok, false);
  }
});
