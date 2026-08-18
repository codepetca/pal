import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { storyGrantCronResponse } from "@/lib/story-grant-cron-result";
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
  const result = await runStoryGrantWorker();
  return storyGrantCronResponse(result);
}
