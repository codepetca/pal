import type { CSSProperties } from "react";
import { Icon, type IconName } from "./icons";
import { NODE_STYLE } from "./node-styles";
import type { RoadmapNode } from "./types";
import styles from "./Node.module.css";

interface NodeProps {
  node: RoadmapNode;
  /** Center coordinates from the layout engine. */
  x: number;
  y: number;
  onSelect: (node: RoadmapNode) => void;
}

/**
 * A single roadmap node rendered as a 3D coin button. Purely
 * presentational — status, size, color and copy all derive from the
 * node's `type`/`status` via NODE_STYLE. No data is hardcoded here.
 */
export function Node({ node, x, y, onSelect }: NodeProps) {
  const style = NODE_STYLE[node.type];
  const isLocked = node.status === "locked";
  const isDone = node.status === "done";
  const isCurrent = node.status === "current";

  // Completed nodes flip to a check (except the chest, which keeps its lid).
  const glyph: IconName = isDone && node.type !== "chest" ? "check" : node.type;

  const className = [styles.node, style.boss ? styles.boss : "", styles[node.status]]
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

      <span className={styles.coin}>
        <Icon name={glyph} className={styles.glyph} />
      </span>

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
