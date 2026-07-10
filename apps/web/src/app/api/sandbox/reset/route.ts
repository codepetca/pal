import { NextRequest, NextResponse } from "next/server";
import { resetLearner } from "@/lib/learner-store";

// POST /api/sandbox/reset
// Dev-only: clears a learner's in-memory state so the sandbox panel can
// be replayed from scratch without restarting the dev server. Not part
// of the real API contract in docs/api.md.
export async function POST(req: NextRequest) {
  const { learner_id } = await req.json();

  if (!learner_id) {
    return NextResponse.json({ error: "missing_learner_id" }, { status: 422 });
  }

  resetLearner(learner_id);
  return NextResponse.json({ status: "reset" });
}
