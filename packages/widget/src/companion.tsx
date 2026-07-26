"use client";

import { usePalWidget } from "./provider";
import type { PalCompanionProps } from "./types";

export function PalCompanion({ variant = "responsive" }: PalCompanionProps) {
  const { density, motion, snapshot, state, theme, viewport } = usePalWidget();
  if (state === "error" || !snapshot) return null;

  const companion = snapshot.companion;

  return (
    <aside
      className="pal-companion"
      data-pal-density={density}
      data-pal-motion={motion}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      data-pal-mood={companion.mood}
      data-pal-variant={variant}
      aria-label={`${companion.name}, your Pal companion. ${companion.moodLabel}. ${companion.message} Level ${companion.level}; ${companion.streak} day rhythm.`}
    >
      <div className="pal-companion-art" aria-hidden="true">
        {companion.assetUrl ? (
          <img src={companion.assetUrl} alt="" width="96" height="96" />
        ) : (
          <span>🐾</span>
        )}
      </div>
      <div className="pal-companion-copy">
        <div className="pal-companion-title">
          <strong>{companion.name}</strong>
          <span>{companion.moodLabel}</span>
        </div>
        <p>{companion.message}</p>
        <div className="pal-companion-stats" aria-label="Companion progress">
          <span>Level {companion.level}</span>
          <span>{companion.streak} day rhythm</span>
        </div>
      </div>
    </aside>
  );
}
