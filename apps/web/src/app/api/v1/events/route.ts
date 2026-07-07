import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedIngest } from "@/lib/ingest-auth";

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

  // TODO: check idempotency key against DB — return "duplicate" if seen
  // TODO: validate event_type against integration allow-list
  // TODO: save event to DB
  // TODO: run rule engine → apply mutations

  return NextResponse.json({ status: "processed" });
}
