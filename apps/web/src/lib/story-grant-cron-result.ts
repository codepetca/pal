import { NextResponse } from "next/server";
import type { StoryGrantWorkerResult } from "@/lib/story-grant-worker";

export type StoryGrantCronOutcome = {
  bodyStatus:
    | "processed"
    | "partial_failure"
    | "incomplete"
    | "partial_failure_incomplete";
  httpStatus: 200 | 500 | 503;
};

export function storyGrantCronOutcome(
  result: StoryGrantWorkerResult,
): StoryGrantCronOutcome {
  if (result.batchLimitReached || result.deadlineReached) {
    return {
      bodyStatus: result.failedLearners > 0
        ? "partial_failure_incomplete"
        : "incomplete",
      httpStatus: 503,
    };
  }
  if (result.failedLearners > 0) {
    return { bodyStatus: "partial_failure", httpStatus: 500 };
  }
  return { bodyStatus: "processed", httpStatus: 200 };
}

export function storyGrantCronResponse(
  result: StoryGrantWorkerResult,
): NextResponse {
  const outcome = storyGrantCronOutcome(result);
  return NextResponse.json(
    { status: outcome.bodyStatus, ...result },
    {
      status: outcome.httpStatus,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
