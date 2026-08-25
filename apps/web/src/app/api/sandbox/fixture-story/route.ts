import { NextRequest, NextResponse } from "next/server";
import { parseFixtureStoryRequest } from "@/app/sandbox/fixture-story-contract";
import { isSandboxPageAllowed } from "@/lib/sandbox-learner";
import {
  InvalidFixtureStoryCommandError,
  projectStoryFixture,
} from "@/lib/story-fixture";

export const dynamic = "force-dynamic";
const MAX_FIXTURE_BODY_BYTES = 65_536;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function boundedJson(
  request: NextRequest,
): Promise<{ body?: unknown; error?: "invalid_request" | "request_too_large" }> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_FIXTURE_BODY_BYTES) {
    return { error: "request_too_large" };
  }
  if (!request.body) return { error: "invalid_request" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let source = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_FIXTURE_BODY_BYTES) {
        await reader.cancel("fixture request too large").catch(() => undefined);
        return { error: "request_too_large" };
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return { body: JSON.parse(source) as unknown };
  } catch {
    return { error: "invalid_request" };
  } finally {
    reader.releaseLock();
  }
}

/** Public, synthetic fixture projection. It has no learner data or credentials. */
export async function POST(request: NextRequest) {
  if (!isSandboxPageAllowed()) {
    return new NextResponse(null, { status: 404 });
  }
  const result = await boundedJson(request);
  if (result.error === "request_too_large") {
    return noStore({ error: result.error }, 413);
  }
  if (result.error) return noStore({ error: result.error }, 400);
  const parsed = parseFixtureStoryRequest(result.body);
  if (!parsed) return noStore({ error: "invalid_fixture_story_request" }, 422);

  try {
    return noStore(await projectStoryFixture(parsed));
  } catch (error) {
    if (error instanceof InvalidFixtureStoryCommandError) {
      return noStore({ error: "invalid_fixture_story_request" }, 422);
    }
    throw error;
  }
}
