// Pure path layout. Given a station count and a seed it returns node positions
// in a winding "snake" that reads as forward progress. The render layer feeds
// these points into a smooth Catmull-Rom curve — this module stays plain math
// so it's deterministic and testable without three.js.

import type { Vec3 } from "./types";

/** mulberry32 — small deterministic PRNG so a seed always yields the same path. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for seeding a path from a student/course id. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface LayoutOptions {
  /** Stations per row before the snake turns back. */
  perRow?: number;
  /** Horizontal spacing between stations in a row. */
  colGap?: number;
  /** Depth spacing between rows. */
  rowGap?: number;
  /** Max seeded horizontal/depth wobble applied to each station. */
  jitter?: number;
  /** Max seeded height bump per station. */
  yBump?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  perRow: 4,
  colGap: 6,
  rowGap: 7,
  jitter: 0.7,
  yBump: 0.9,
};

/**
 * Lay out `count` stations as a centered boustrophedon (each row reverses
 * direction) with gentle seeded wobble. Rows advance in +z, so the path always
 * moves "forward" toward the finish. Deterministic for a given (count, seed).
 */
export function layoutNodes(count: number, seed: number, opts: LayoutOptions = {}): Vec3[] {
  const { perRow, colGap, rowGap, jitter, yBump } = { ...DEFAULTS, ...opts };
  const rng = makeRng(seed);
  const nodes: Vec3[] = [];
  const centerOffset = ((perRow - 1) / 2) * colGap;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const posInRow = i % perRow;
    // Reverse column order on odd rows to make a continuous snake.
    const col = row % 2 === 0 ? posInRow : perRow - 1 - posInRow;

    const x = col * colGap - centerOffset + (rng() - 0.5) * 2 * jitter;
    const z = row * rowGap + (rng() - 0.5) * 2 * jitter;
    const y = rng() * yBump;

    nodes.push({ x, y, z });
  }

  return nodes;
}
