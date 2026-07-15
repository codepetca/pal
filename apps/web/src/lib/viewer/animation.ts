// Pure procedural animation — the same approach the LibGDX game uses ("walk/
// sprint animations built in code"), reproduced as plain math. Each function
// returns limb rotations (radians) for one instant; the render layer applies
// them to the boxel model every frame. No three.js, no React: fully testable.

import type { AnimName, Pose } from "./types";

const REST: Pose = {
  leftArm: 0,
  rightArm: 0,
  leftLeg: 0,
  rightLeg: 0,
  bodyY: 0,
  torsoLean: 0,
  rootY: 0,
};

// Gait tuning. Amplitudes are in radians; speeds in radians/second of cycle.
const WALK = { speed: 6, legAmp: 0.5, armAmp: 0.42, bob: 0.06, lean: 0.06 };
const RUN = { speed: 10, legAmp: 0.95, armAmp: 0.85, bob: 0.13, lean: 0.34 };
const IDLE = { speed: 1.6, sway: 0.05, breathe: 0.04 };
const JUMP_HEIGHT = 1.7;

/**
 * Instantaneous pose for a cyclic gait (idle/walk/run) at time `t` seconds, or a
 * jump pose parameterised by `jumpP` in [0,1] when `anim === "jump"`.
 *
 * Walk/run use the natural human counter-swing: a leg and the *opposite* arm
 * move together (left leg with right arm).
 */
export function pose(anim: AnimName, t: number, jumpP = 0): Pose {
  switch (anim) {
    case "idle": {
      const s = Math.sin(t * IDLE.speed);
      return {
        ...REST,
        leftArm: s * IDLE.sway,
        rightArm: -s * IDLE.sway,
        bodyY: s * IDLE.breathe,
      };
    }
    case "walk":
      return gait(t, WALK);
    case "run":
      return gait(t, RUN);
    case "jump":
      return jumpPose(jumpP);
    default:
      return { ...REST };
  }
}

function gait(t: number, cfg: typeof WALK): Pose {
  const phase = t * cfg.speed;
  const swing = Math.sin(phase);
  return {
    leftLeg: swing * cfg.legAmp,
    rightLeg: -swing * cfg.legAmp,
    // Arms counter-swing to the legs.
    leftArm: -swing * cfg.armAmp,
    rightArm: swing * cfg.armAmp,
    // Two small bobs per stride (one per foot-plant).
    bodyY: Math.abs(Math.sin(phase)) * cfg.bob,
    torsoLean: cfg.lean,
    rootY: 0,
  };
}

/**
 * Jump arc over `p` in [0,1]: rootY follows a sine so it's 0 at take-off and
 * landing and peaks at mid-air; knees and arms tuck up toward the apex.
 */
export function jumpPose(p: number): Pose {
  const c = Math.min(1, Math.max(0, p));
  const arc = Math.sin(Math.PI * c); // 0 → 1 → 0
  return {
    leftLeg: arc * 0.7,
    rightLeg: arc * 0.5,
    leftArm: -0.4 - arc * 0.8,
    rightArm: -0.4 - arc * 0.8,
    bodyY: 0,
    torsoLean: arc * 0.2,
    rootY: arc * JUMP_HEIGHT,
  };
}

/** Choose a gait from ground speed (world units / second). */
export function gaitForSpeed(unitsPerSec: number): AnimName {
  if (unitsPerSec < 0.1) return "idle";
  if (unitsPerSec < 6) return "walk";
  return "run";
}
