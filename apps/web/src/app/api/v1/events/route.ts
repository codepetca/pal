import { NextRequest, NextResponse } from "next/server";
import { defaultRulePack, processEvent } from "@pal/engine";
import { isAuthorizedIngest } from "@/lib/ingest-auth";
import { validateIngestBody } from "@/lib/ingest-validation";
import {
  hasProcessedEvent,
  loadLearner,
  recordProcessedEvent,
  saveLearner,
} from "@/lib/learner-store";

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  if (!isAuthorizedIngest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const validation = validateIngestBody(await req.json());
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }
  const { event, idempotencyKey, learnerId } = validation.value;

  if (hasProcessedEvent(idempotencyKey)) {
    return NextResponse.json({ status: "duplicate" });
  }

  // The engine decides what changes; processEvent applies those changes and feeds the
  // derived events back through the engine until the cascade settles. Nothing else in
  // the codebase is allowed to write learner state.
  const state = loadLearner(learnerId);
  const result = processEvent(event, state, defaultRulePack);
  saveLearner(learnerId, result.state);

  // Record the key only after the state change is persisted. If anything above threw,
  // the key was never recorded and a retry reprocesses the event instead of getting a
  // spurious "duplicate" and losing the update. Keep this immediately after the save,
  // and keep the whole stretch from `hasProcessedEvent` to here free of `await` — the
  // check/record pair is not atomic, and only the synchronous path prevents two
  // concurrent deliveries of the same key from both applying (see learner-store.ts).
  recordProcessedEvent(idempotencyKey);

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
