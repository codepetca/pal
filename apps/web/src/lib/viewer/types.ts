// Domain types for the 3D roadmap viewer.
//
// The viewer is READ-ONLY: it renders a class of students progressing through a
// shared course. It mutates no learner state (that stays the rule engine's job),
// so these types describe a snapshot to draw, never a thing to write back.

export type AssignmentKind = "lesson" | "quiz" | "project" | "milestone";

export interface Assignment {
  id: string;
  title: string;
  kind: AssignmentKind;
}

export interface Course {
  id: string;
  title: string;
  /** Ordered stations along the path. The first is the start line. */
  assignments: Assignment[];
}

export interface Student {
  /** Internal id — never a real student id. */
  id: string;
  /** Pseudonymous handle shown in the UI (no names/emails/PII). */
  handle: string;
  /** Filename under /viewer/skins used for this student's character. */
  skin: string;
  /** How many assignments are finished. 0..course.assignments.length */
  completedCount: number;
}

export interface ClassData {
  course: Course;
  students: Student[];
}

/** Plain vector so the pure layer never depends on three.js. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type AnimName = "idle" | "walk" | "run" | "jump";

/**
 * A character pose in radians (limb rotations about X) plus vertical offsets.
 * Consumed by the render layer to drive the boxel model each frame.
 */
export interface Pose {
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
  /** Small breathing/step bob applied to the whole body. */
  bodyY: number;
  /** Forward torso lean (X rotation of the upper body). */
  torsoLean: number;
  /** Extra root height, used by the jump arc. */
  rootY: number;
}

export type NodeStatus = "done" | "current" | "locked";
