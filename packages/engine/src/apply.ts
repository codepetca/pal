import type { IncomingEvent, LearnerState, Mutation } from "./types";

const STREAK_MILESTONE = 7;

// Applies a batch of mutations produced by one evaluate() call to a
// learner's state. Pure — no DB, no side effects. The only place
// economy/pet/world fields are allowed to change.
export function applyMutations(
  state: LearnerState,
  mutations: Mutation[],
  occurredAt: string
): { state: LearnerState; derivedEvents: IncomingEvent[] } {
  const next: LearnerState = {
    economy: { ...state.economy },
    pet: { ...state.pet },
    world: { ...state.world, unlocked_object_ids: [...state.world.unlocked_object_ids] },
  };

  let grantedXp = false;

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "XP_GRANT":
        next.economy.xp += mutation.amount;
        grantedXp = true;
        break;
      case "PET_MOOD": {
        next.pet.mood = mutation.mood;
        const expiresAt = new Date(occurredAt);
        expiresAt.setMinutes(expiresAt.getMinutes() + mutation.duration_minutes);
        next.pet.mood_expires_at = expiresAt.toISOString();
        break;
      }
      case "WORLD_UNLOCK":
        if (!next.world.unlocked_object_ids.includes(mutation.asset_ref_id)) {
          next.world.unlocked_object_ids.push(mutation.asset_ref_id);
        }
        break;
      case "WORLD_STAGE":
        next.world.stage = mutation.stage;
        break;
      case "ACHIEVEMENT":
      case "NUDGE":
        // Not modeled in LearnerState yet — no-op until badges/nudges exist.
        break;
    }
  }

  // A single evaluate() call can contain multiple XP_GRANT mutations
  // (e.g. assignment-xp + assignment-on-time-bonus both fire for one
  // event) — that must still only count as one streak tick.
  if (grantedXp) {
    next.economy.streak_current += 1;
  }
  next.economy.last_event_at = occurredAt;

  const derivedEvents: IncomingEvent[] = [];
  if (state.economy.streak_current < STREAK_MILESTONE && next.economy.streak_current >= STREAK_MILESTONE) {
    derivedEvents.push({ event_type: "STREAK_MILESTONE", occurred_at: occurredAt, metadata: {} });
  }

  return { state: next, derivedEvents };
}
