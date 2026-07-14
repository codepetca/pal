// The event received from an integration (after validation), or a derived event
// produced by a mutation handler during the cascade. See docs/rule-engine.md.
export type IncomingEvent = {
  event_type: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

// Current state of a learner passed into the rule engine
export type LearnerState = {
  economy: {
    // XP toward the next level. Spent (deducted) on level-up.
    xp: number;
    // Every XP point ever earned. Never spent — the basis for lifetime achievements.
    xp_lifetime: number;
    level: number;
    streak_current: number;
    // UTC calendar day (YYYY-MM-DD) the streak last advanced. Anchors day-over-day
    // continuity so a non-streak event (e.g. an assignment) can't stand in for a check-in.
    streak_last_day: string | null;
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
  | { type: "LEVEL_GRANT"; levels: number }
  | { type: "STREAK"; continue_streak: boolean }
  | { type: "PET_MOOD"; mood: string; duration_minutes: number }
  | { type: "WORLD_STAGE"; stage: number }
  | { type: "WORLD_UNLOCK"; asset_ref_id: string }
  | { type: "ACHIEVEMENT"; badge_id: string }
  | { type: "NUDGE"; copy_id: string };

// A single rule in a rule pack
export type Rule = {
  id: string;
  trigger: { event_type: string };
  conditions: Array<{
    field: string;
    op: "eq" | "gte" | "lte";
    value: unknown;
  }>;
  effects: Mutation[];
};

export type RulePack = {
  id: string;
  rules: Rule[];
};
