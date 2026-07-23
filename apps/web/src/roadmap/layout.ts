import { NODE_STYLE } from "./node-styles";
import type { RoadmapNode, Track, Unit } from "./types";

/**
 * Pure layout engine. Turns a Track into absolute coordinates for a
 * vertical snaking path: nodes ride a sine wave, boss nodes break to
 * center, unit banners span the lane. No React, no DOM — testable.
 */

export interface PlacedNode {
  node: RoadmapNode;
  x: number;
  y: number;
}
export interface PlacedBanner {
  unit: Unit;
  top: number;
}
export interface Segment {
  /** SVG path `d` for one connector between adjacent nodes. */
  d: string;
  /** Traveled portion (start node completed) vs. locked-ahead. */
  done: boolean;
}
export interface RoadmapLayout {
  width: number;
  height: number;
  banners: PlacedBanner[];
  nodes: PlacedNode[];
  segments: Segment[];
}

export interface LayoutOptions {
  width?: number;
  amplitude?: number;
  gap?: number;
  top?: number;
  bannerHeight?: number;
  bannerGap?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  width: 540,
  amplitude: 176,
  gap: 68,
  top: 24,
  bannerHeight: 84,
  bannerGap: 44,
};

export function computeLayout(track: Track, options: LayoutOptions = {}): RoadmapLayout {
  const o = { ...DEFAULTS, ...options };
  const center = o.width / 2;

  const banners: PlacedBanner[] = [];
  const nodes: PlacedNode[] = [];
  const segments: Segment[] = [];

  let y = o.top;
  let seq = 0;

  for (const unit of track.units) {
    banners.push({ unit, top: y });
    y += o.bannerHeight + o.bannerGap;

    let prevHalf = 6;
    const unitPoints: PlacedNode[] = [];

    for (const node of unit.nodes) {
      const style = NODE_STYLE[node.type];
      const half = style.size / 2;
      y += prevHalf + o.gap + half;
      // Boss nodes anchor to center so they read as milestones on-axis.
      const x = style.boss ? center : center + Math.sin(seq * 1.2) * o.amplitude;
      const placed: PlacedNode = { node, x, y };
      nodes.push(placed);
      unitPoints.push(placed);
      prevHalf = half + (style.boss ? 18 : 0);
      seq += 1;
    }

    // Connectors within the unit (path breaks between units, banner sits there).
    for (let i = 0; i < unitPoints.length - 1; i++) {
      const p = unitPoints[i];
      const q = unitPoints[i + 1];
      const midY = (p.y + q.y) / 2;
      segments.push({
        d: `M${p.x} ${p.y} C ${p.x} ${midY}, ${q.x} ${midY}, ${q.x} ${q.y}`,
        done: p.node.status === "done",
      });
    }

    y += prevHalf + o.gap;
  }

  const layout: RoadmapLayout = { width: o.width, height: y + 48, banners, nodes, segments };

  // ponytail: dev-only invariant instead of a full test harness (web pkg
  // has no vitest). Fails loud if placement drops or duplicates a node.
  if (process.env.NODE_ENV !== "production") {
    const expected = track.units.reduce((n, u) => n + u.nodes.length, 0);
    console.assert(
      layout.nodes.length === expected,
      `[roadmap] layout placed ${layout.nodes.length} nodes, expected ${expected}`,
    );
  }

  return layout;
}

/** Find the current node + its placement (for the mascot + "continue" CTA). */
export function findCurrent(layout: RoadmapLayout): PlacedNode | null {
  return layout.nodes.find((p) => p.node.status === "current") ?? null;
}
