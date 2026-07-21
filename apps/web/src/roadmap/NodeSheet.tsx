"use client";

import { Icon, type IconName } from "./icons";
import { NODE_STYLE } from "./node-styles";
import type { NodeStatus, RoadmapNode } from "./types";
import styles from "./NodeSheet.module.css";

interface NodeSheetProps {
  node: RoadmapNode;
  onClose: () => void;
}

const STATUS: Record<
  NodeStatus,
  { pill: string; color: string; bg: string; cta: string; ctaClass?: string }
> = {
  done: { pill: "Completed", color: "#58CC02", bg: "rgba(88,204,2,.16)", cta: "Review", ctaClass: styles.review },
  current: { pill: "In progress", color: "#3DE6A6", bg: "rgba(61,230,166,.16)", cta: "Start now" },
  locked: { pill: "Locked", color: "#8A90A4", bg: "rgba(138,144,164,.14)", cta: "Locked", ctaClass: styles.locked },
};

/** Detail modal for a tapped node. Copy + action derive from status. */
export function NodeSheet({ node, onClose }: NodeSheetProps) {
  const style = NODE_STYLE[node.type];
  const status = STATUS[node.status];
  const isLocked = node.status === "locked";
  const glyph: IconName = isLocked ? "lock" : node.type;
  const ctaLabel =
    node.status === "current" ? (style.boss ? "Start challenge" : "Start now") : status.cta;

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label={node.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div
            className={styles.emblem}
            style={{
              background: isLocked
                ? "var(--locked)"
                : `radial-gradient(circle at 50% 30%, ${style.top}, ${style.edge})`,
              color: isLocked ? "var(--locked-ink)" : "#fff",
            }}
          >
            <Icon name={glyph} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className={styles.title}>{node.title}</h3>
            <div className={styles.pills}>
              <span className={styles.pill} style={{ color: style.top, background: `${style.top}22` }}>
                {style.label}
              </span>
              <span className={styles.pill} style={{ color: status.color, background: status.bg }}>
                {status.pill}
              </span>
            </div>
          </div>
          <div className={styles.xp}>
            <div className={styles.xpNum}>+{node.xp}</div>
            <span className={styles.xpLabel}>XP{node.crown ? ` · 👑${node.crown}` : ""}</span>
          </div>
        </div>

        <p className={styles.body}>{style.blurb}</p>

        <button
          type="button"
          className={`${styles.cta} ${status.ctaClass ?? ""}`}
          disabled={isLocked}
          onClick={onClose}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
