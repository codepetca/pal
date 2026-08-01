import assert from "node:assert/strict";
import test from "node:test";
import type { Db } from "@pal/db";
import { identifyIntegration, resolveIntegration } from "./integration-auth";

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

test("accepts a secret rotation when another request creates the row", async () => {
  let selectCount = 0;
  let updateCount = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            selectCount += 1;
            return selectCount === 1
              ? []
              : [
                  {
                    id: "00000000-0000-4000-8000-000000000010",
                    secretHash: "created-by-concurrent-request",
                    allowedEventTypes: ["platform.session.started"],
                  },
                ];
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          updateCount += 1;
        },
      }),
    }),
  } as unknown as Db;

  const integration = await resolveIntegration(
    {
      slug: "pika",
      name: "Pika",
      secret: "rotated-pika-secret-at-least-32-characters",
    },
    db,
  );
  assert.equal(integration.id, "00000000-0000-4000-8000-000000000010");
  assert.deepEqual(integration.allowedEventTypes, ["platform.session.started"]);
  assert.equal(updateCount, 1);
});
