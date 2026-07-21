import type { CSSProperties } from "react";
import styles from "./PixelCat.module.css";

interface PixelCatProps {
  /** Rendered size in px. */
  size?: number;
  /** "wave" idle-loops row 0; "sit" shows a single calm frame. */
  pose?: "wave" | "sit";
  /** Frame index 0–63 for the "sit" pose (col + row*8). */
  frame?: number;
  /** Slight sticker rotation. */
  tilt?: boolean;
  className?: string;
}

/** Retro pixel-cat mascot. Used beside the current node and atop the stats rail. */
export function PixelCat({ size = 64, pose = "wave", frame = 36, tilt = false, className }: PixelCatProps) {
  const col = frame % 8;
  const row = Math.floor(frame / 8);
  const spriteStyle: CSSProperties =
    pose === "sit"
      ? { backgroundPosition: `calc(var(--fs) * ${-col}) calc(var(--fs) * ${-row})` }
      : {};

  return (
    <span
      className={`${styles.sticker} ${tilt ? styles.tilt : ""} ${className ?? ""}`}
      style={{ "--fs": `${size}px` } as CSSProperties}
      aria-hidden
    >
      <span className={`${styles.sprite} ${pose === "wave" ? styles.wave : ""}`} style={spriteStyle} />
    </span>
  );
}
