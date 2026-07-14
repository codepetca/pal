import type { IncomingEvent, LearnerState, Mutation } from "./types";

// Derived events are synthetic: SCREAMING_SNAKE, emitted by mutation handlers,
// never accepted on the ingest API. See docs/rule-engine.md.
export const XP_CHANGED = "XP_CHANGED";
export const LEVEL_UP = "LEVEL_UP";
export const STREAK_MILESTONE = "STREAK_MILESTONE";

export type ApplyResult = {
  state: LearnerState;
  derived: IncomingEvent[];
};

// Applies a list of mutations to learner state and reports the derived events
// the change created. Pure: no DB, no clock, no side effects — the caller owns
// persistence and the transaction.
export function applyMutations(
  state: LearnerState,
  mutations: Mutation[],
  event: IncomingEvent
): ApplyResult {
  const next: LearnerState = {
    economy: { ...state.economy },
    pet: { ...state.pet },
    world: {
      ...state.world,
      unlocked_object_ids: [...state.world.unlocked_object_ids],
    },
  };

  const derivedTypes = new Set<string>();

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "XP_GRANT": {
        // XP is a balance toward the next level, so a level-up spends it via a
        // negative grant. It can never go below zero.
        const xp = Math.max(0, next.economy.xp + mutation.amount);
        if (mutation.amount > 0) next.economy.xp_lifetime += mutation.amount;
        if (xp !== next.economy.xp) {
          next.economy.xp = xp;
          derivedTypes.add(XP_CHANGED);
        }
        break;
      }

      case "LEVEL_GRANT": {
        next.economy.level += mutation.levels;
        derivedTypes.add(LEVEL_UP);
        break;
      }

      case "STREAK": {
        if (!mutation.continue_streak) {
          next.economy.streak_current = 0;
          next.economy.streak_last_day = null;
          break;
        }
        const today = utcDay(event.occurred_at);
        // Same day: the streak already advanced, so a second check-in is a no-op.
        // This is what stops a learner banking a day's bonus twice.
        if (next.economy.streak_last_day === today) break;
        next.economy.streak_current =
          next.economy.streak_last_day === previousUtcDay(today)
            ? next.economy.streak_current + 1
            : 1;
        next.economy.streak_last_day = today;
        derivedTypes.add(STREAK_MILESTONE);
        break;
      }

      case "PET_MOOD": {
        next.pet.mood = mutation.mood;
        next.pet.mood_expires_at = new Date(
          new Date(event.occurred_at).getTime() + mutation.duration_minutes * 60_000
        ).toISOString();
        break;
      }

      case "WORLD_STAGE": {
        next.world.stage = mutation.stage;
        break;
      }

      case "WORLD_UNLOCK": {
        // Unlock rules use `gte` thresholds, so they re-fire on every later
        // milestone. Unlocking is idempotent by design.
        if (!next.world.unlocked_object_ids.includes(mutation.asset_ref_id)) {
          next.world.unlocked_object_ids.push(mutation.asset_ref_id);
        }
        break;
      }

      case "ACHIEVEMENT":
      case "NUDGE":
        // Both are records for other domains (UnlockLedger, nudge delivery) and
        // carry no learner-state change. The caller persists them.
        break;
    }
  }

  next.economy.last_event_at = event.occurred_at;

  const derived: IncomingEvent[] = [...derivedTypes].map((event_type) => ({
    event_type,
    occurred_at: event.occurred_at,
    metadata: {},
  }));

  return { state: next, derived };
}

// A learner's streak day is UTC. A student checking in at 9pm local time west of
// UTC lands on the next UTC day, which can cost them a streak — acceptable for M1,
// revisit when integrations can declare a timezone.
function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function previousUtcDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
