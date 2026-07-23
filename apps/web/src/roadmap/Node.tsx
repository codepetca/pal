import type { CSSProperties } from "react";
import { Glyph, Icon } from "./icons";
import { NODE_STYLE } from "./node-styles";
import type { RoadmapNode } from "./types";
import styles from "./Node.module.css";

/** Chest art (pixel treasure chest). A node's `icon` overrides these. */
const CHEST_CLOSED = "/chest-closed.png";
const CHEST_OPEN = "/chest-open.png";

interface NodeProps {
  node: RoadmapNode;
  /** Center coordinates from the layout engine. */
  x: number;
  y: number;
  /** Chest whose predecessor is done — ungrays, expands, and rattles. */
  ready?: boolean;
  onSelect: (node: RoadmapNode) => void;
}

/**
 * A single roadmap node: a solid 3D coin button that stands upright on the
 * tilted board (counter-rotated in CSS). Completed nodes turn gold with a
 * check; the current node glows with a star and a floating START. Purely
 * presentational — everything derives from the node's type/status.
 */
export function Node({ node, x, y, ready, onSelect }: NodeProps) {
  const style = NODE_STYLE[node.type];
  const isChest = node.type === "chest";
  const isDone = node.status === "done";
  const isCurrent = node.status === "current";
  const chestReady = isChest && !!ready && !isDone;
  const isLocked = node.status === "locked" && !chestReady;

  // Non-chest glyph: check when done, else a custom icon, else the current-node
  // star or the type default. Chests render an image (below), not a glyph.
  const glyphEl = isDone ? (
    <Icon name="check" className={styles.glyph} />
  ) : node.icon ? (
    <Glyph icon={node.icon} className={styles.glyph} />
  ) : (
    <Icon name={isCurrent ? "star" : node.type} className={styles.glyph} />
  );
  // Closed while locked/ready, open once collected. A custom icon wins.
  const chestSrc = node.icon || (isDone ? CHEST_OPEN : CHEST_CLOSED);

  const statusClass = chestReady ? styles.ready : styles[node.status];
  const className = [styles.node, style.boss ? styles.boss : "", isChest ? styles.chest : "", statusClass]
    .filter(Boolean)
    .join(" ");

  const cssVars = {
    "--x": `${x}px`,
    "--y": `${y}px`,
    "--size": `${style.size}px`,
    "--depth": `${style.depth}px`,
    "--top": style.top,
    "--edge": style.edge,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={className}
      style={cssVars}
      onClick={() => onSelect(node)}
      aria-label={`${style.label}: ${node.title} — ${node.status}`}
    >
      {isCurrent && <span className={styles.startBubble}>{style.boss ? "CHALLENGE" : "START"}</span>}

      {isChest ? (
        <span className={styles.chestBox}>
          <img src={chestSrc} alt="" className={styles.chestImg} draggable={false} />
        </span>
      ) : (
        <span className={styles.coin}>{glyphEl}</span>
      )}

      {!!node.crown && !isLocked && (
        <span className={styles.crown}>
          <Icon name="crown" className={styles.crownIcon} />
          <span className={styles.crownNum}>{node.crown}</span>
        </span>
      )}

      {isLocked && (
        <span className={styles.lockBadge}>
          <Icon name="lock" className={styles.lockIcon} />
        </span>
      )}

      <span className={styles.label}>{node.title}</span>
    </button>
  );
}
