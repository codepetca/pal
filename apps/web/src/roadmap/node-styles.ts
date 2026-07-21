import type { NodeType } from "./types";

/**
 * Per-type visual + copy config. Adding a new node type is a one-line
 * change here — layout and components read everything from this map,
 * so no rendering code changes.
 *
 * `top` / `edge` are the two faces of the 3D "coin": bright top face and
 * a darker bottom edge cast as a hard offset shadow. `depth` is that
 * shadow's height in px (how far the button pushes down on click).
 * Palette is Duolingo-authentic and deliberately high-contrast.
 */
export interface NodeStyle {
  label: string;
  top: string;
  edge: string;
  /** Diameter in px. Bosses tower over daily nodes. */
  size: number;
  depth: number;
  boss: boolean;
  blurb: string;
}

export const NODE_STYLE: Record<NodeType, NodeStyle> = {
  assignment: {
    label: "Assignment",
    top: "#58CC02",
    edge: "#3F8F00",
    size: 78,
    depth: 8,
    boss: false,
    blurb:
      "A short skill check. Finish it to keep your streak alive and bank XP toward the next level.",
  },
  log: {
    label: "Daily log",
    top: "#1CB0F6",
    edge: "#1084C4",
    size: 72,
    depth: 7,
    boss: false,
    blurb:
      "Log what you worked on today. Small but steady — daily logs are what build the streak flame.",
  },
  chest: {
    label: "Reward chest",
    top: "#FFC800",
    edge: "#C99700",
    size: 76,
    depth: 8,
    boss: false,
    blurb:
      "A bonus stash unlocked by clearing the nodes before it. Pure XP, no work required.",
  },
  project: {
    label: "Project · Milestone",
    top: "#CE82FF",
    edge: "#9B4ED6",
    size: 118,
    depth: 12,
    boss: true,
    blurb:
      "A major build. Projects are worth serious XP and open the rest of the unit — treat it like a boss.",
  },
  test: {
    label: "Test · Boss",
    top: "#FF4B4B",
    edge: "#C62A2A",
    size: 122,
    depth: 13,
    boss: true,
    blurb:
      "The unit boss. Pass the test to earn a crown, close the unit, and unlock the next track segment.",
  },
};
