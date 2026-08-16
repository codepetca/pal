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

for (const activityDay of ["9999-99-99", "2026-02-30"]) {
  test(`fixture story route rejects invalid calendar day ${activityDay}`, async () => {
    const response = await POST(
      new NextRequest("https://pal.example/api/sandbox/fixture-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termWeeks: 16,
          commands: [{
            type: "action",
            id: "invalid-day",
            action: "daily-log-completed",
            context: { activityDay },
          }],
        }),
      }),
    );
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error: "invalid_fixture_story_request",
    });
  });
}

test("fixture story route enforces its byte limit without Content-Length", async () => {
  const request = new NextRequest(
    "https://pal.example/api/sandbox/fixture-story",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        termWeeks: 16,
        commands: [],
        padding: "x".repeat(70_000),
      }),
    },
  );
  assert.equal(request.headers.get("content-length"), null);
  const response = await POST(request);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "request_too_large" });
});
