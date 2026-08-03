import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("the unauthenticated learner-id world route remains retired", () => {
  const legacyRoute = new URL(
    "../app/api/v1/world/[learnerId]/route.ts",
    import.meta.url,
  );
  assert.equal(existsSync(legacyRoute), false);
});
