"use client";

import { useEffect, useMemo, useState } from "react";
import { Achievement } from "./Achievement";
import { CollectableModal } from "./CollectableModal";
import { Glyph, Icon } from "./icons";
import { NodeSheet } from "./NodeSheet";
import { RoadmapView } from "./RoadmapView";
import { UnitEditor } from "./UnitEditor";
import { completeNode, openChest, pickCollectable, readyChestIds, trackProgress } from "./progress";
import type { Collectable, RoadmapData, RoadmapNode } from "./types";
import styles from "./Dashboard.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

interface DashboardProps {
  data: RoadmapData;
}

/**
 * Student viewer: winding roadmap over a full-bleed photo, a bottom control
 * dock, a collectables tray, and celebration overlays. `data` lives in state
 * so completing an assignment, opening a chest, or teacher edits re-render the
 * whole path — everything is data-driven. Background is /public/roadmap-bg.jpg.
 */
export function Dashboard({ data: initial }: DashboardProps) {
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState<RoadmapNode | null>(null);
  const [editing, setEditing] = useState(false);
  const [celebrate, setCelebrate] = useState<{ n: number; icon: string }>({ n: 0, icon: "star" });
  const [reveal, setReveal] = useState<{ collectable: Collectable; empty: boolean } | null>(null);
  const [collectedIds, setCollectedIds] = useState<string[]>([]);

  const trackIndex = 0;
  const track = data.tracks[trackIndex];
  const collectables = track.collectables ?? [];
  const progress = trackProgress(track);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  const readySet = useMemo(() => readyChestIds(track), [track]);
  const collectedItems = collectedIds
    .map((id) => collectables.find((c) => c.id === id))
    .filter((c): c is Collectable => !!c);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const setTrack = (next: typeof track) =>
    setData((d) => {
      const tracks = d.tracks.slice();
      tracks[trackIndex] = next;
      return { ...d, tracks };
    });

  const handleComplete = (id: string) => {
    const res = completeNode(track, id);
    if (!res.node) return; // only a real complete event marks something done
    setTrack(res.track);
    setSelected(null);
    setCelebrate((c) => ({ n: c.n + 1, icon: res.node!.icon || "star" }));
  };

  const handleSelect = (node: RoadmapNode) => {
    if (node.type === "chest") {
      if (readySet.has(node.id)) openChestFlow(node); // only ready chests open; only on click
      return;
    }
    setSelected(node);
  };

  const openChestFlow = (chest: RoadmapNode) => {
    const pick = pickCollectable(collectables, collectedIds);
    setTrack(openChest(track, chest.id));
    setReveal(
      pick
        ? { collectable: pick, empty: false }
        : { collectable: { id: "__none", name: "All collectables found!", icon: "🏆" }, empty: true },
    );
  };

  const finishReveal = () => {
    if (reveal && !reveal.empty) {
      setCollectedIds((ids) => (ids.includes(reveal.collectable.id) ? ids : [...ids, reveal.collectable.id]));
    }
    setReveal(null);
  };

  const applyEdit = (next: RoadmapData) => {
    setData(next);
    setEditing(false);
  };

  return (
    <div className={styles.layout}>
      <div className={styles.bg} aria-hidden />

      <main className={styles.main}>
        <RoadmapView track={track} onSelect={handleSelect} />
      </main>

      {collectedItems.length > 0 && (
        <div className={styles.tray} aria-label="Collectables">
          {collectedItems.map((c) => (
            <div key={c.id} className={styles.slot} title={c.name}>
              <Glyph icon={c.icon} className={styles.slotGlyph} />
            </div>
          ))}
        </div>
      )}

      <div className={styles.dock}>
        <div className={styles.progress}>
          <div className={styles.progressTop}>
            <span className={styles.progressLabel}>
              {progress.done}/{progress.total} done
            </span>
            <span className={styles.progressXp}>
              <Icon name="gem" /> {fmt(track.learner.xp)} XP
            </span>
          </div>
          <div className={styles.progressBar}>
            <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className={styles.dockBtns}>
          <button
            type="button"
            className={`${styles.dockBtn} ${styles.complete}`}
            onClick={() => progress.currentId && handleComplete(progress.currentId)}
            disabled={!progress.currentId}
          >
            <Icon name="check" /> Complete
          </button>
          <button
            type="button"
            className={`${styles.dockBtn} ${styles.anim}`}
            onClick={() => setCelebrate((c) => ({ n: c.n + 1, icon: "star" }))}
          >
            <Icon name="star" /> Run animation
          </button>
          <button
            type="button"
            className={`${styles.dockBtn} ${styles.edit}`}
            onClick={() => setEditing(true)}
          >
            <Icon name="pencil" /> Edit
          </button>
        </div>
      </div>

      {celebrate.n > 0 && (
        <Achievement key={celebrate.n} icon={celebrate.icon} onDone={() => setCelebrate((c) => ({ ...c, n: 0 }))} />
      )}

      {reveal && <CollectableModal collectable={reveal.collectable} empty={reveal.empty} onDone={finishReveal} />}

      {selected && <NodeSheet node={selected} onComplete={handleComplete} onClose={() => setSelected(null)} />}

      {editing && (
        <div className={styles.editorOverlay}>
          <UnitEditor
            data={data}
            onSave={applyEdit}
            onClose={() => setEditing(false)}
            activeTrackIndex={trackIndex}
          />
        </div>
      )}
    </div>
  );
}
