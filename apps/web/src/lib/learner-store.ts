import type { LearnerState } from "@pal/engine";

// The store the applier writes through.
//
// This is an in-memory stand-in for `@pal/db`, which lands in M1. It is process-local,
// so on Vercel it survives only as long as one warm function instance: two requests can
// land on two instances and see different state, and everything is lost on cold start.
// That is fine for the dev sandbox and for exercising the full ingest → engine → world
// loop locally, and it is not fine for anything else.
//
// When @pal/db arrives, `load`/`save` become a single transaction that takes the learner
// row lock described in docs/data-model.md. Keeping the seam here means the route and the
// applier do not change when it does.
const learners = new Map<string, LearnerState>();
const seenIdempotencyKeys = new Set<string>();

export function initialLearnerState(): LearnerState {
  return {
    economy: {
      xp: 0,
      xp_lifetime: 0,
      level: 1,
      streak_current: 0,
      streak_last_day: null,
      last_event_at: null,
    },
    pet: { mood: "neutral", mood_expires_at: null },
    world: { stage: 0, unlocked_object_ids: [] },
  };
}

export function loadLearner(learnerId: string): LearnerState {
  return learners.get(learnerId) ?? initialLearnerState();
}

export function saveLearner(learnerId: string, state: LearnerState): void {
  learners.set(learnerId, state);
}

// Dedupes retries of the same event. Returns true the first time a key is seen.
// The real implementation is a unique constraint on the events table.
export function claimIdempotencyKey(key: string): boolean {
  if (seenIdempotencyKeys.has(key)) return false;
  seenIdempotencyKeys.add(key);
  return true;
}
