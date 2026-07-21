"use client";

import { useMemo } from "react";
import { computeLayout, findCurrent, type LayoutOptions } from "./layout";
import { Icon } from "./icons";
import { NODE_STYLE } from "./node-styles";
import { Node } from "./Node";
import { PalMascot } from "./icons";
import type { RoadmapNode, Track } from "./types";
import styles from "./RoadmapView.module.css";

interface RoadmapViewProps {
  track: Track;
  onSelect: (node: RoadmapNode) => void;
  /** Optional layout overrides (lane width, wave amplitude, spacing). */
  layout?: LayoutOptions;
}

/**
 * The snaking roadmap board. Computes node/banner/spine positions from
 * the track data and renders them. This is the star of the page —
 * everything it draws is derived from `track`, nothing is hardcoded.
 */
export function RoadmapView({ track, onSelect, layout }: RoadmapViewProps) {
  const board = useMemo(() => computeLayout(track, layout), [track, layout]);
  const current = findCurrent(board);

  const donePath = board.segments.filter((s) => s.done).map((s) => s.d).join(" ");
  const remainPath = board.segments.filter((s) => !s.done).map((s) => s.d).join(" ");

  return (
    <div className={styles.scroll}>
      <div className={styles.board} style={{ width: board.width, height: board.height }}>
        <svg
          className={styles.spine}
          viewBox={`0 0 ${board.width} ${board.height}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="roadmap-spine" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3de6a6" />
              <stop offset="0.5" stopColor="#1cb0f6" />
              <stop offset="1" stopColor="#ce82ff" />
            </linearGradient>
          </defs>
          <path className={styles.remain} d={remainPath} />
          <path className={styles.done} stroke="url(#roadmap-spine)" d={donePath} />
        </svg>

        {board.banners.map(({ unit, top }) => (
          <div
            key={unit.id}
            className={styles.banner}
            style={{
              top,
              background: `linear-gradient(135deg, ${unit.color}2e, ${unit.color}12)`,
              borderColor: `${unit.color}44`,
            }}
          >
            <div className={styles.bannerIcon} style={{ color: unit.color }}>
              <Icon name={unit.icon} />
            </div>
            <div className={styles.bannerKind} style={{ color: unit.color }}>
              {unit.kind}
            </div>
            <div className={styles.bannerTitle}>{unit.title}</div>
            {unit.subtitle && <div className={styles.bannerSub}>{unit.subtitle}</div>}
          </div>
        ))}

        {board.nodes.map(({ node, x, y }) => (
          <Node key={node.id} node={node} x={x} y={y} onSelect={onSelect} />
        ))}

        {current && (
          <div
            className={styles.mascot}
            style={{
              left: clampMascotX(current.x, board.width, NODE_STYLE[current.node.type].size),
              top: current.y + 10,
            }}
          >
            <PalMascot />
          </div>
        )}
      </div>
    </div>
  );
}

/** Keep the mascot next to the current node but inside the lane. */
function clampMascotX(nodeX: number, boardWidth: number, nodeSize: number) {
  const side = nodeX > boardWidth / 2 ? -1 : 1;
  const x = nodeX + side * (nodeSize / 2 + 54);
  return Math.max(46, Math.min(boardWidth - 46, x));
}
