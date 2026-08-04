import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../next.config";

test("pet artwork permits anonymous cross-origin image reads", async () => {
  assert.ok(nextConfig.headers);
  const rules = await nextConfig.headers();
  const petAssets = rules.find((rule) => rule.source === "/assets/pets/:path*");

  assert.ok(petAssets);
  assert.deepEqual(petAssets.headers, [
    {
      key: "Access-Control-Allow-Origin",
      value: "*",
    },
  ]);
});
