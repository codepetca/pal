// Pure progress math. No three.js, no React — just numbers, so it runs under
// the node:test runner exactly like the rule engine's tests.

import type { NodeStatus } from "./types";

/** Clamp helper. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Fraction of the course finished, 0..1.
 * A course with 0 assignments is treated as fully complete (nothing to do).
 */
export function progressFraction(completedCount: number, total: number): number {
  if (total <= 0) return 1;
  return clamp(completedCount, 0, total) / total;
}

/** Percent 0..100, rounded to a whole number for display. */
export function percentComplete(completedCount: number, total: number): number {
  return Math.round(progressFraction(completedCount, total) * 100);
}

/**
 * Index of the station the character currently stands on: the first unfinished
 * one. When everything is done it rests on the final station.
 */
export function currentIndex(completedCount: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(completedCount, 0, total - 1);
}

/** Status of a station relative to how far the student has come. */
export function nodeStatus(index: number, completedCount: number): NodeStatus {
  if (index < completedCount) return "done";
  if (index === completedCount) return "current";
  return "locked";
}

/**
 * Position along the *path* as a parameter in [0,1], where 0 is the first
 * station and 1 is the last. Used to place the character on the curve. With
 * `total` stations there are `total-1` segments between them.
 */
export function progressT(completedCount: number, total: number): number {
  if (total <= 1) return 0;
  return currentIndex(completedCount, total) / (total - 1);
}
