import { NextRequest, NextResponse } from "next/server";
import { defaultRulePack, processEvent, type IncomingEvent } from "@pal/engine";
import { isAuthorizedIngest } from "@/lib/ingest-auth";
import { isIngestableEventType } from "@/lib/event-types";
import { claimIdempotencyKey, loadLearner, saveLearner } from "@/lib/learner-store";

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

  if (!isIngestableEventType(event_type)) {
    return NextResponse.json({ error: "unknown_event_type" }, { status: 422 });
  }

  if (Number.isNaN(Date.parse(occurred_at))) {
    return NextResponse.json({ error: "invalid_occurred_at" }, { status: 422 });
  }

  if (!claimIdempotencyKey(idempotency_key)) {
    return NextResponse.json({ status: "duplicate" });
  }

  const event: IncomingEvent = {
    event_type,
    occurred_at: new Date(occurred_at).toISOString(),
    metadata: metadata ?? {},
  };

  // The engine decides what changes; processEvent applies those changes and feeds the
  // derived events back through the engine until the cascade settles. Nothing else in
  // the codebase is allowed to write learner state.
  const state = loadLearner(learner_id);
  const result = processEvent(event, state, defaultRulePack);
  saveLearner(learner_id, result.state);

  if (result.truncated.length > 0) {
    // Belongs in the AuditLog once M1 lands. Until then it at least surfaces a rule
    // pack that cascades deeper than the engine will follow.
    console.warn(
      `[pal] cascade hit the depth limit for ${event.event_type}; dropped: ${result.truncated.join(", ")}`
    );
  }

  return NextResponse.json({
    status: "processed",
    mutations: result.mutations,
  });
}
