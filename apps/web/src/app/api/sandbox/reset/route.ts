import { NextRequest, NextResponse } from "next/server";
import { resetLearnerInDb } from "@/lib/db-learner";
import { resolveSandboxIntegration } from "@/lib/integration-auth";
import {
  isSandboxLearnerId,
  isSandboxRuntimeAllowed,
} from "@/lib/sandbox-learner";

// POST /api/sandbox/reset
// Dev-only: clears a learner's state so the sandbox panel can be replayed
// from scratch. Not part of the real API contract in docs/api.md.
export async function POST(req: NextRequest) {
  if (!isSandboxRuntimeAllowed()) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const learnerId =
    typeof body === "object" && body !== null && "learner_id" in body
      ? body.learner_id
      : undefined;

  if (!isSandboxLearnerId(learnerId)) {
    return NextResponse.json(
      { error: "invalid_sandbox_learner_id" },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }

  const integration = await resolveSandboxIntegration();
  await resetLearnerInDb(integration.id, learnerId);
  return NextResponse.json(
    { status: "reset" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
