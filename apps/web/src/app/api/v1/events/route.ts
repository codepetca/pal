import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedIngest } from "@/lib/ingest-auth";
import { applyEvent } from "@/lib/learner-store";

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  if (!isAuthorizedIngest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const { idempotency_key, learner_id, event_type, occurred_at, metadata } = body;

  if (!idempotency_key || !learner_id || !event_type || !occurred_at) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 422 });
  }

  // Derived events (STREAK_MILESTONE, LEVEL_UP, ...) are synthetic and never
  // accepted on the ingest API — see "Rules of the cascade" in docs/rule-engine.md.
  if (/^[A-Z0-9_]+$/.test(event_type)) {
    return NextResponse.json({ error: "synthetic_event_type" }, { status: 422 });
  }

  if (Number.isNaN(Date.parse(occurred_at))) {
    return NextResponse.json({ error: "invalid_occurred_at" }, { status: 422 });
  }

  // TODO: check idempotency key against DB — return "duplicate" if seen
  // TODO: validate event_type against integration allow-list
  // TODO: save the raw event to DB (only derived state is persisted, in-memory, for now)
  applyEvent(learner_id, { event_type, occurred_at, metadata: metadata ?? {} });

  return NextResponse.json({ status: "processed" });
}
