import { NextRequest, NextResponse } from "next/server";
import { resetLearner } from "@/lib/learner-store";

// POST /api/sandbox/reset
// Dev-only: clears a learner's in-memory state so the sandbox panel can
// be replayed from scratch without restarting the dev server. Not part
// of the real API contract in docs/api.md.
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

  const { learner_id } = await req.json();

  if (!learner_id) {
    return NextResponse.json({ error: "missing_learner_id" }, { status: 422 });
  }

  resetLearner(learner_id);
  return NextResponse.json({ status: "reset" });
}
