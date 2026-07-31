import { NextRequest, NextResponse } from "next/server";
import { isSandboxLearnerId } from "@/lib/sandbox-learner";

// POST /api/sandbox/events
// Server-side proxy for the dev sandbox. The browser can never hold an
// integration secret, so this route plays the part of an integration's
// backend (like Pika's): it attaches the secret and forwards the event
// to the real, durable ingest endpoint.
export async function POST(req: NextRequest) {
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

  const body: unknown = await req.json();
  const learnerId =
    typeof body === "object" && body !== null && "learner_id" in body
      ? body.learner_id
      : undefined;
  if (!isSandboxLearnerId(learnerId)) {
    return NextResponse.json(
      { error: "invalid_sandbox_learner_id" },
      { status: 422 },
    );
  }

  const res = await fetch(new URL("/api/v1/events", req.nextUrl.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
