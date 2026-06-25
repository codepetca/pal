// The event received from an integration (after validation)
export type IncomingEvent = {
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

// Current state of a learner passed into the rule engine
export type LearnerState = {
  economy: {
    xp: number;
    level: number;
    streak_current: number;
    last_event_at: string | null;
  };
  pet: {
    mood: string;
    mood_expires_at: string | null;
  };
  world: {
    stage: number;
    unlocked_object_ids: string[];
  };
};

// A single change produced by the rule engine
export type Mutation =
  | { type: "XP_GRANT"; amount: number }
  | { type: "PET_MOOD"; mood: string; duration_minutes: number }
  | { type: "WORLD_STAGE"; stage: number }
  | { type: "WORLD_UNLOCK"; asset_ref_id: string }
  | { type: "ACHIEVEMENT"; badge_id: string };

// A single rule in a rule pack
export type Rule = {
  id: string;
  trigger: { event_type: string };
  conditions: Array<{ field: string; op: "eq" | "gte" | "lte"; value: unknown }>;
  effects: Mutation[];
};

export type RulePack = {
  id: string;
  rules: Rule[];
};
