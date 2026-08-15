import { NextRequest, NextResponse } from "next/server";
import { parseFixtureStoryRequest } from "@/app/sandbox/fixture-story-contract";
import { projectStoryFixture } from "@/lib/story-fixture";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Public, synthetic fixture projection. It has no learner data or credentials. */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    return noStore({ error: "request_too_large" }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "invalid_request" }, 400);
  }
  const parsed = parseFixtureStoryRequest(body);
  if (!parsed) return noStore({ error: "invalid_fixture_story_request" }, 422);

  return noStore(await projectStoryFixture(parsed));
}
