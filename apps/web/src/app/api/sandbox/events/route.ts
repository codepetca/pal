import { NextRequest, NextResponse } from "next/server";
import { POST as ingestEvent } from "@/app/api/v1/events/route";
import {
  isSandboxLearnerId,
  isSandboxRuntimeAllowed,
} from "@/lib/sandbox-learner";

// POST /api/sandbox/events
// Server-side proxy for the dev sandbox. The browser can never hold an
// integration secret, so this route plays the part of an integration's
// backend (like Pika's): it attaches the secret and forwards the event
// to the real, durable ingest endpoint.
export async function POST(req: NextRequest) {
  if (!isSandboxRuntimeAllowed()) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const secret = process.env.SANDBOX_INTEGRATION_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "sandbox_not_configured",
        hint: "Set SANDBOX_INTEGRATION_SECRET in apps/web/.env.local",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
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

  // Invoke the real ingest route in-process. Building an outbound URL from a
  // request Host header could leak the sandbox integration secret through an
  // SSRF; the sandbox needs the production handler, not a network round trip.
  const res = await ingestEvent(
    new NextRequest("http://pal.internal/api/v1/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    }),
  );

  return NextResponse.json(await res.json(), {
    status: res.status,
    headers: { "Cache-Control": "no-store" },
  });
}
