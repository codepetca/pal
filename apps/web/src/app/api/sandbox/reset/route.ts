import { NextRequest, NextResponse } from "next/server";
import { resetLearnerInDb } from "@/lib/db-learner";
import { isSandboxLearnerId } from "@/lib/sandbox-learner";

// POST /api/sandbox/reset
// Dev-only: clears a learner's state so the sandbox panel can be replayed
// from scratch. Not part of the real API contract in docs/api.md.
export async function POST(req: NextRequest) {
  // Blocked on production only. Vercel preview builds also run with
  // NODE_ENV=production, and the panel's Reset must keep working there —
  // so check VERCEL_ENV first and fall back to NODE_ENV off-Vercel.
  const isProduction = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
  if (isProduction) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body: unknown = await req.json();
  const learnerId =
    typeof body === "object" && body !== null && "learner_id" in body
      ? body.learner_id
      : undefined;

  if (!isSandboxLearnerId(learnerId)) {
    return NextResponse.json({ error: "invalid_sandbox_learner_id" }, { status: 422 });
  }

  await resetLearnerInDb(learnerId);
  return NextResponse.json({ status: "reset" });
}
