"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { NodeSheet } from "./NodeSheet";
import { RoadmapView } from "./RoadmapView";
import { Sidebar } from "./Sidebar";
import { StatsRail } from "./StatsRail";
import type { RoadmapData, RoadmapNode } from "./types";
import styles from "./Dashboard.module.css";

const fmt = (n: number) => n.toLocaleString("en-US");

interface DashboardProps {
  data: RoadmapData;
}

/**
 * Full desktop dashboard: sidebar nav + snaking roadmap + stats rail.
 * Owns the two pieces of view state — which track is shown and which
 * node's detail sheet is open. Everything below renders from `data`.
 */
export function Dashboard({ data }: DashboardProps) {
  const [trackIndex, setTrackIndex] = useState(0);
  const [selected, setSelected] = useState<RoadmapNode | null>(null);
  const track = data.tracks[trackIndex];

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const cycleTrack = () => {
    setSelected(null);
    setTrackIndex((i) => (i + 1) % data.tracks.length);
  };

  return (
    <div className={styles.layout}>
      <div className={styles.sidebarWrap}>
        <Sidebar learnerName="Your Pal" learnerRank={`Level ${track.learner.level} · ${track.learner.rank}`} />
      </div>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.crumb}>
            <b>Roadmap</b>
            <span>{track.name}</span>
          </div>
          <button
            type="button"
            className={styles.trackChip}
            onClick={cycleTrack}
            title="Switch track — the whole roadmap is data-driven"
          >
            <span className={styles.dot} style={{ background: track.accent, boxShadow: `0 0 8px ${track.accent}` }} />
            {track.name}
            <Icon name="chevron" />
          </button>
          <div className={styles.spacer} />
          <div className={styles.tbStats}>
            <div className={`${styles.stat} ${styles.lvl}`}>
              Lv <span className={styles.tnum}>{track.learner.level}</span>
            </div>
            <div className={`${styles.stat} ${styles.streak}`}>
              <Icon name="flame" />
              <span className={styles.tnum}>{track.learner.streak}</span>
            </div>
            <div className={`${styles.stat} ${styles.gem}`}>
              <Icon name="gem" />
              <span className={styles.tnum}>{fmt(track.learner.gems)}</span>
            </div>
          </div>
        </header>

        <div className={styles.roadmapPane}>
          <RoadmapView track={track} onSelect={setSelected} />
        </div>
      </main>

      <div className={styles.railWrap}>
        <StatsRail track={track} onSelectNode={setSelected} />
      </div>

      {selected && <NodeSheet node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
