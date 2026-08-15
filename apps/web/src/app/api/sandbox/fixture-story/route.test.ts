import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

test("fixture story route returns only redacted synthetic state", async () => {
  const response = await POST(
    new NextRequest("https://pal.example/api/sandbox/fixture-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ termWeeks: 16, commands: [] }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const raw = await response.text();
  assert.equal(raw.includes("pips-first-recipe"), false);
  assert.equal(/\bPip\b/.test(raw), false);
  assert.equal(raw.includes("/assets/world/reward-"), false);
});

test("fixture story route rejects malformed commands", async () => {
  const response = await POST(
    new NextRequest("https://pal.example/api/sandbox/fixture-story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        termWeeks: 16,
        commands: [{ type: "action", id: "x", action: "reset" }],
      }),
    }),
  );
  assert.equal(response.status, 422);
});
