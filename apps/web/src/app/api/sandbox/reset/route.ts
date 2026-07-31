import { NextRequest, NextResponse } from "next/server";
import { createSandboxSession } from "@/lib/sandbox-session";

// POST /api/sandbox/reset
// Dev/preview-only: starts a signed, stateless engine session. Carrying state
// in the signed token keeps separate serverless invocations consistent without
// exposing the signing secret or pretending process-local memory is shared.
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

  const { learner_id } = (await req.json()) as { learner_id?: unknown };

  if (typeof learner_id !== "string" || !learner_id) {
    return NextResponse.json({ error: "missing_learner_id" }, { status: 422 });
  }

  const secret = process.env.SANDBOX_INTEGRATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "sandbox_not_configured",
        hint: "Set SANDBOX_INTEGRATION_SECRET in apps/web/.env.local",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "reset",
    ...createSandboxSession(learner_id, secret),
  });
}
