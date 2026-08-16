import { NextRequest, NextResponse } from "next/server";
import { parseFixtureStoryRequest } from "@/app/sandbox/fixture-story-contract";
import { readBoundedJson } from "@/lib/bounded-json";
import { isSandboxPageAllowed } from "@/lib/sandbox-learner";
import { projectStoryFixture } from "@/lib/story-fixture";

export const dynamic = "force-dynamic";
const MAX_FIXTURE_BODY_BYTES = 65_536;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Public, synthetic fixture projection. It has no learner data or credentials. */
export async function POST(request: NextRequest) {
  if (!isSandboxPageAllowed()) {
    return new NextResponse(null, { status: 404 });
  }
  const result = await readBoundedJson(request, MAX_FIXTURE_BODY_BYTES);
  if (!result.ok && result.error === "request_too_large") {
    return noStore({ error: result.error }, 413);
  }
  if (!result.ok) return noStore({ error: "invalid_request" }, 400);
  const parsed = parseFixtureStoryRequest(result.value);
  if (!parsed) return noStore({ error: "invalid_fixture_story_request" }, 422);

  return noStore(await projectStoryFixture(parsed));
}
