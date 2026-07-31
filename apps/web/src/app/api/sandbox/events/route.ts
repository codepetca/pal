import { NextRequest, NextResponse } from "next/server";
import { validateIngestBody } from "@/lib/ingest-validation";
import {
  applySandboxEvent,
  InvalidSandboxSessionError,
} from "@/lib/sandbox-session";

// POST /api/sandbox/events
// Applies an event to a signed sandbox session. The browser carries the state
// token, but only the server can authenticate or advance it. That preserves
// engine authority and idempotency across separate serverless invocations.
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

  const body = (await req.json()) as { session?: unknown; event?: unknown };
  if (typeof body.session !== "string" || !body.session) {
    return NextResponse.json(
      { error: "missing_sandbox_session" },
      { status: 422 },
    );
  }

  const validation = validateIngestBody(body.event);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  try {
    return NextResponse.json(
      applySandboxEvent(body.session, validation.value, secret),
    );
  } catch (error) {
    if (error instanceof InvalidSandboxSessionError) {
      return NextResponse.json(
        { error: "invalid_sandbox_session" },
        { status: 422 },
      );
    }
    throw error;
  }
}
