import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { STORY_SKETCH_REWARDS_EFFECTIVE_AT } from "@/lib/story-sketch-rollout";
import { runStoryGrantWorker } from "@/lib/story-grant-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const authorization = authorizeCronRequest(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
  );
  if (authorization === "configuration_error") {
    return response({ error: "cron_not_configured" }, 503);
  }
  if (authorization !== "authorized") {
    return response({ error: "unauthorized" }, 401);
  }
  if (!STORY_SKETCH_REWARDS_EFFECTIVE_AT) {
    return response({ error: "story_rollout_not_configured" }, 503);
  }

  const result = await runStoryGrantWorker({
    rolloutEffectiveAt: STORY_SKETCH_REWARDS_EFFECTIVE_AT,
  });
  if (result.failedLearners > 0) {
    return response({ status: "partial_failure", ...result }, 500);
  }
  return response({ status: "processed", ...result }, 200);
}
