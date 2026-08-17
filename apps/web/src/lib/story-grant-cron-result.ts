import type { StoryGrantWorkerResult } from "@/lib/story-grant-worker";

export type StoryGrantCronOutcome = {
  bodyStatus: "processed" | "partial_failure" | "incomplete";
  httpStatus: 200 | 500 | 503;
};

export function storyGrantCronOutcome(
  result: StoryGrantWorkerResult,
): StoryGrantCronOutcome {
  if (result.failedLearners > 0) {
    return { bodyStatus: "partial_failure", httpStatus: 500 };
  }
  if (result.batchLimitReached) {
    return { bodyStatus: "incomplete", httpStatus: 503 };
  }
  return { bodyStatus: "processed", httpStatus: 200 };
}
