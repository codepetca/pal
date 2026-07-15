// One place for the viewer's palette so scenes stay cohesive and the polish
// pass has a single knob. Calm, Apple-keynote tones: cool neutrals + one soft
// indigo accent, warm highlight for "you are here", violet for milestones.

export const PALETTE = {
  skyTop: "#eef4fd",
  skyBottom: "#cfe0f4",
  ground: "#e9eef6",

  pathDone: "#6b8afd",
  pathTodo: "#cdd7e5",

  nodeDone: "#6b8afd",
  nodeCurrent: "#ffce7a",
  nodeLocked: "#d7dee8",
  milestone: "#a78bfa",

  ink: "#33415c",
  inkSoft: "#8a97ad",
} as const;

export const ISLAND = {
  top: "#dfe9f8",
  soil: "#c7d3e4",
} as const;
