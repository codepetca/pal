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
  /** Per-node blurb shown in the detail modal. Falls back to the type blurb. */
  description?: string;
  /** Link to the actual assignment page. Opens from the detail modal. */
  href?: string;
  /**
   * Custom icon override. A known icon name, an emoji, or an image URL
   * (http/https, "/path", or data:). Falls back to the node type's icon.
   */
  icon?: string;
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

/**
 * A reward hidden in a chest. The pool is authored behind the scenes
 * (teacher / backend); each chest hands out one the learner hasn't got yet,
 * so there are never duplicates. `icon` is an emoji or image URL.
 */
export interface Collectable {
  id: string;
  name: string;
  icon: string;
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
  /** Reward pool for this track's chests. Authored by the teacher/backend. */
  collectables?: Collectable[];
}

export interface RoadmapData {
  tracks: Track[];
}
