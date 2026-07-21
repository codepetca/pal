/**
 * Roadmap data schema.
 *
 * The entire roadmap UI is a pure function of this data — nothing is
 * hardcoded into the components. Swap the JSON, the path re-renders.
 * Shapes are intentionally serializable so they can come straight from
 * an API route (e.g. a future `/api/v1/roadmap/[learnerId]`).
 */

/** Small nodes = daily work. Boss nodes (project, test) are milestones. */
export type NodeType = "assignment" | "log" | "chest" | "project" | "test";

export type NodeStatus = "done" | "current" | "locked";

export interface RoadmapNode {
  id: string;
  type: NodeType;
  title: string;
  /** XP awarded on completion. Drives node weight + reward copy. */
  xp: number;
  status: NodeStatus;
  /** Mastery level 0–3. Renders a crown badge when > 0. */
  crown?: number;
  /**
   * Free-form, integration-supplied metadata (due date, weight, unit
   * of the source assignment, …). Never put PII here — see CLAUDE.md.
   */
  meta?: Record<string, string | number | boolean>;
}

export interface Unit {
  id: string;
  /** Short eyebrow, e.g. "Unit 1". */
  kind: string;
  title: string;
  subtitle?: string;
  /** Hex accent for the unit banner + spine tint. */
  color: string;
  /** Which glyph decorates the banner. */
  icon: NodeType;
  nodes: RoadmapNode[];
}

export interface Learner {
  level: number;
  rank: string;
  xp: number;
  xpToNext: number;
  streak: number;
  gems: number;
  /** Last 7 days of activity, oldest → newest. */
  week: boolean[];
}

/**
 * Cohort ranking row. Aliases are pre-anonymized by the integration —
 * NO names, emails, or raw student IDs (privacy rule, CLAUDE.md).
 * Rankings are gated behind a product decision; see StatsRail.
 */
export interface LeaderboardEntry {
  alias: string;
  level: number;
  xp: number;
  color: string;
  you?: boolean;
}

export interface Track {
  id: string;
  name: string;
  /** Hex accent used by the track chip + dot. */
  accent: string;
  subtitle?: string;
  learner: Learner;
  leaderboard?: LeaderboardEntry[];
  units: Unit[];
}

export interface RoadmapData {
  tracks: Track[];
}
