import { applyMutations, defaultRulePack, evaluate } from "@pal/engine";
import type { IncomingEvent, LearnerState } from "@pal/engine";

// In-memory placeholder for the real DB, coming in M1. Resets whenever
// the dev server restarts. Keyed by learner_id.
const store = new Map<string, LearnerState>();

// Depth limit 3 per docs/rule-engine.md: original event (depth 0) ->
// derived (1) -> derived (2) -> stop. Anything deeper is a rule-pack
// config bug and is dropped.
// TODO: log dropped cascades to the AuditLog once it exists (M1).
const MAX_CASCADE_DEPTH = 3;

function defaultState(): LearnerState {
  return {
    economy: { xp: 0, level: 1, streak_current: 0, last_event_at: null },
    pet: { mood: "neutral", mood_expires_at: null },
    world: { stage: 0, unlocked_object_ids: [] },
  };
}

function applyAtDepth(learnerId: string, event: IncomingEvent, depth: number): LearnerState {
  const state = store.get(learnerId) ?? defaultState();
  const mutations = evaluate(event, state, defaultRulePack);
  const { state: nextState, derivedEvents } = applyMutations(state, mutations, event.occurred_at);
  store.set(learnerId, nextState);

  // Derived events run at depth 1 and 2; a cascade past that is dropped.
  if (depth + 1 < MAX_CASCADE_DEPTH) {
    for (const derived of derivedEvents) {
      applyAtDepth(learnerId, derived, depth + 1);
    }
  }

  return store.get(learnerId) as LearnerState;
}

export function applyEvent(learnerId: string, event: IncomingEvent): LearnerState {
  return applyAtDepth(learnerId, event, 0);
}

export function getLearnerState(learnerId: string): LearnerState {
  return store.get(learnerId) ?? defaultState();
}

export function resetLearner(learnerId: string): void {
  store.delete(learnerId);
}
