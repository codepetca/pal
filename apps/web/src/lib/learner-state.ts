import type { LearnerState } from "@pal/engine";

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
