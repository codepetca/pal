"use client";

import { Glyph } from "./icons";
import type { Collectable } from "./types";
import styles from "./CollectableModal.module.css";

interface CollectableModalProps {
  collectable: Collectable;
  /** True when the pool is exhausted (nothing new to award). */
  empty?: boolean;
  /** Press "Done" — sends the collectable to the tray and closes. */
  onDone: () => void;
}

/**
 * Chest-open reveal. Shows the collectable with a celebratory burst and waits
 * for the learner to press Done, at which point it drops into the bottom tray.
 */
export function CollectableModal({ collectable, empty, onDone }: CollectableModalProps) {
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="Collectable">
      <div className={styles.card}>
        <div className={styles.burst} />
        <div className={styles.eyebrow}>{empty ? "Chest opened" : "New collectable!"}</div>
        <div className={styles.item}>
          <Glyph icon={collectable.icon} className={styles.glyph} />
        </div>
        <div className={styles.name}>{collectable.name}</div>
        <button type="button" className={styles.done} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
