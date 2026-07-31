import { NextRequest, NextResponse } from "next/server";
import { resetEconomyInDb } from "@/lib/db-learner";

// POST /api/sandbox/reset-economy
// Dev-only: resets the learner's economy to level 1 / 0 XP without clearing
// events or the learner record. Used by the sandbox "Reset XP & level" button.
export async function POST(req: NextRequest) {
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

  await resetEconomyInDb(learner_id);
  return NextResponse.json({ status: "reset" });
}