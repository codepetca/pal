"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Glyph } from "./icons";
import styles from "./Achievement.module.css";

const PRAISES = [
  "Great job!",
  "Awesome!",
  "Nice work!",
  "Boom!",
  "Crushed it!",
  "Legendary!",
  "You did it!",
  "Way to go!",
  "Nailed it!",
  "Unstoppable!",
];

const SPARKS = Array.from({ length: 22 });

interface AchievementProps {
  /** The badge image: icon name, emoji, or image URL. */
  icon?: string;
  /** Headline. Random praise when omitted. */
  title?: string;
  /** Fired when the animation finishes so the parent can unmount it. */
  onDone?: () => void;
  durationMs?: number;
}

/**
 * Big center-screen celebration: a badge springs up with a glow ring, confetti
 * sparks, and a headline, then fades. Mount with a changing `key` to replay.
 */
export function Achievement({ icon = "star", title, onDone, durationMs = 1700 }: AchievementProps) {
  const [praise] = useState(() => title ?? PRAISES[Math.floor(Math.random() * PRAISES.length)]);

  useEffect(() => {
    const t = setTimeout(() => onDone?.(), durationMs);
    return () => clearTimeout(t);
  }, [onDone, durationMs]);

  return (
    <div className={styles.overlay} aria-hidden>
      <div className={styles.flash} />
      <div className={styles.stage}>
        <div className={styles.ring} />
        <div className={styles.sparks}>
          {SPARKS.map((_, i) => (
            <span
              key={i}
              className={styles.spark}
              style={
                {
                  ["--a" as string]: `${(i * 360) / SPARKS.length + (i % 2 ? 8 : 0)}deg`,
                  ["--d" as string]: `${140 + (i % 4) * 42}px`,
                  ["--h" as string]: `${(i * 47) % 360}deg`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className={styles.badge}>
          <Glyph icon={icon} className={styles.glyph} />
        </div>
      </div>
      <div className={styles.title}>{praise}</div>
    </div>
  );
}
