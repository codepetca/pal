import type { LearnerState } from "@pal/engine";

import { initialLearnerState } from "./learner-state";

// The store the applier writes through.
//
// This is an in-memory stand-in for `@pal/db`, which lands in M1. It is process-local,
// so on Vercel it survives only as long as one warm function instance: two requests can
// land on two instances and see different state, and everything is lost on cold start.
// That is enough for exercising the ingest → engine → world loop in one local process,
// and it is not fine for deployed or durable state. The preview sandbox therefore uses
// a signed request-carried session instead (see sandbox-session.ts).
//
// When @pal/db arrives, `load`/`save` become a single transaction that takes the learner
// row lock described in docs/data-model.md. Keeping the seam here means the route and the
// applier do not change when it does.
const learners = new Map<string, LearnerState>();
const seenIdempotencyKeys = new Set<string>();

export function loadLearner(learnerId: string): LearnerState {
  return learners.get(learnerId) ?? initialLearnerState();
}

export function saveLearner(learnerId: string, state: LearnerState): void {
  learners.set(learnerId, state);
}

// Dedupes retries of the same event. The key is recorded only *after* the event's
// state change has been persisted (see the ingest route), so an event that fails
// mid-processing is not marked seen and a retry reprocesses it rather than being
// silently dropped as a duplicate.
//
// ⚠️ This check-then-record pair is NOT atomic. It is only safe because the route's
// path from `hasProcessedEvent` to `recordProcessedEvent` is synchronous — Node
// cannot interleave a second request in between. Two concurrent deliveries of the
// same key with an `await` on that path would both pass the check and both apply.
// When @pal/db lands, do NOT keep this seam and swap the internals: replace both
// calls with an INSERT on the events table's unique key inside the same transaction
// as the state write, and treat a conflict as "duplicate". That is atomic and
// failure-safe at once; this seam is only failure-safe.
export function hasProcessedEvent(key: string): boolean {
  return seenIdempotencyKeys.has(key);
}

export function recordProcessedEvent(key: string): void {
  seenIdempotencyKeys.add(key);
}
