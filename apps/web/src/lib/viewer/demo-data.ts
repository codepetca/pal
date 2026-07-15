// Self-contained demo data: one class of students moving through one shared
// course. Handles are fictional and pseudonymous — no names, emails, or real
// student ids — matching pal's privacy rules. Swapping this for pal's live
// `GET /api/v1/world/[learnerId]` is a data-source change, not a rewrite.

import type { ClassData, Course, Student } from "./types";

const course: Course = {
  id: "course-foundations",
  title: "Foundations of Code",
  assignments: [
    { id: "a01", title: "Welcome & Setup", kind: "lesson" },
    { id: "a02", title: "Variables & Types", kind: "lesson" },
    { id: "a03", title: "Checkpoint: Basics", kind: "quiz" },
    { id: "a04", title: "Conditionals", kind: "lesson" },
    { id: "a05", title: "Loops", kind: "lesson" },
    { id: "a06", title: "Milestone: Mini Project", kind: "milestone" },
    { id: "a07", title: "Functions", kind: "lesson" },
    { id: "a08", title: "Arrays & Objects", kind: "lesson" },
    { id: "a09", title: "Checkpoint: Data", kind: "quiz" },
    { id: "a10", title: "Milestone: Capstone", kind: "milestone" },
  ],
};

const SKINS = [
  "player.png",
  "skin-2.png",
  "skin-3.png",
  "skin-4.png",
  "skin-5.png",
  "skin-6.png",
];

// Pseudonymous handles: animal codename + short hex. Deterministic, no PII.
const roster: Array<{ handle: string; completedCount: number }> = [
  { handle: "otter-7f3", completedCount: 10 },
  { handle: "maple-a14", completedCount: 8 },
  { handle: "quartz-3c9", completedCount: 6 },
  { handle: "willow-b02", completedCount: 5 },
  { handle: "ember-5d8", completedCount: 4 },
  { handle: "cedar-9a1", completedCount: 3 },
  { handle: "koi-2e7", completedCount: 2 },
  { handle: "nimbus-c46", completedCount: 0 },
];

const students: Student[] = roster.map((r, i) => ({
  id: `learner-${r.handle}`,
  handle: r.handle,
  skin: SKINS[i % SKINS.length],
  completedCount: r.completedCount,
}));

export const demoClass: ClassData = { course, students };
