"use client";

import { usePalWidget } from "./provider";

export function PalCollection() {
  const { density, snapshot, state, theme, viewport } = usePalWidget();
  if (state === "error" || !snapshot) return null;

  const items = snapshot.collection?.items ?? [];
  return (
    <section
      className="pal-surface pal-collection"
      data-pal-density={density}
      data-pal-theme={theme}
      data-pal-viewport={viewport}
      aria-labelledby="pal-collection-title"
    >
      <header className="pal-collection-header">
        <h2 id="pal-collection-title">Collection</h2>
        <span>{items.length} unlocked</span>
      </header>
      {items.length > 0 ? (
        <ul className="pal-collection-list">
          {items.map((item) => (
            <li key={item.id} title={item.description}>
              <span aria-hidden="true">{item.icon ?? "★"}</span>
              <strong>{item.label}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pal-collection-empty">
          Complete a Weekly Rhythm to unlock your first keepsake.
        </p>
      )}
    </section>
  );
}
