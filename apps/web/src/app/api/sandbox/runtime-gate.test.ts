import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as postEvent } from "./events/route";
import { POST as postReadToken } from "./read-token/route";
import { POST as postReset } from "./reset/route";

const learnerId = "sandbox-00000000-0000-4000-8000-000000000001";

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ learner_id: learnerId }),
  });
}

async function sandboxRouteStatuses(): Promise<number[]> {
  const responses = await Promise.all([
    postEvent(request("/api/sandbox/events")),
    postReadToken(request("/api/sandbox/read-token")),
    postReset(request("/api/sandbox/reset")),
  ]);
  return responses.map((response) => response.status);
}

test("all persisted sandbox APIs fail closed in public previews", async () => {
  const previousVercelEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "preview";
    assert.deepEqual(await sandboxRouteStatuses(), [404, 404, 404]);
  } finally {
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test("production keeps persisted sandbox APIs closed", async () => {
  const previousVercelEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assert.deepEqual(await sandboxRouteStatuses(), [404, 404, 404]);
  } finally {
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});
