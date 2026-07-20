"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

const TEST_LEARNER_ID = "test-learner-001";

const PANEL_EVENTS = [
  { label: "Assignment completed", event_type: "assignment.completed", metadata: { on_time: false } },
  { label: "Assignment completed (on time)", event_type: "assignment.completed", metadata: { on_time: true } },
  { label: "Daily check-in", event_type: "daily_checkin.created", metadata: {} },
];

function Pet() {
  return <Image src="/assets/pets/default.png" alt="Your pet" width={110} height={110} priority />;
}

export default function WorldView() {
  const [level, setLevel] = useState(1);
  const [streak, setStreak] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const refreshSeq = useRef(0);

  useEffect(() => {
    refreshWorld();
  }, []);

  async function refreshWorld() {
    const seq = ++refreshSeq.current;
    const res = await fetch(`/api/v1/world/${TEST_LEARNER_ID}`);
    const data = await res.json();
    // A later refreshWorld() call can have its response arrive first.
    // Drop this one if a newer request has since been issued, so a
    // stale response can't overwrite the current economy values.
    if (seq !== refreshSeq.current) return;
    setLevel(data.economy.level);
    setStreak(data.economy.streak);
  }

  async function fireEvent(event_type: string, metadata: Record<string, unknown>) {
    const idempotency_key = `sandbox-${Date.now()}`;
    const res = await fetch("/api/sandbox/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotency_key,
        learner_id: TEST_LEARNER_ID,
        event_type,
        occurred_at: new Date().toISOString(),
        metadata,
      }),
    });
    const data = await res.json();
    const status = res.ok ? data.status : "error";
    setLog((prev) => [`→ ${event_type}: ${status}`, ...prev]);
    await refreshWorld();
  }

  async function resetDemo() {
    await fetch("/api/sandbox/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ learner_id: TEST_LEARNER_ID }),
    });
    setLog([]);
    await refreshWorld();
  }

  return (
    <div className={styles.world}>
      <Image
        src="/assets/mockups/pika-student/pika-student-dashboard-expanded.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.backdrop}
      />

      <svg
        className={styles.ground}
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M0,120 Q360,60 720,100 Q1080,140 1440,80 L1440,200 L0,200Z" fill="#4E8B3A" />
      </svg>

      <div className={styles.pet}>
        <Pet />
      </div>

      <div className={styles.hud}>
        <span className={styles.logo}>PAL</span>
      </div>

      <div className={styles.groundHud}>
        <span className={styles.levelBadge}>Lv {level}</span>
        <span className={styles.streak}>🔥 {streak}</span>
      </div>

      <button
        className={styles.panelToggle}
        onClick={() => setPanelOpen((open) => !open)}
        aria-label="Toggle event control panel"
      >
        ⚡
      </button>

      {panelOpen && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Fire an event</span>
            <button className={styles.panelClose} onClick={() => setPanelOpen(false)} aria-label="Close panel">
              ✕
            </button>
          </div>

          <div className={styles.panelButtons}>
            {PANEL_EVENTS.map((e) => (
              <button
                key={e.event_type + e.label}
                className={styles.panelButton}
                onClick={() => fireEvent(e.event_type, e.metadata)}
              >
                {e.label}
              </button>
            ))}
          </div>

          <div className={styles.panelLogLabel}>Log</div>
          <div className={styles.panelLog}>
            {log.length === 0 ? (
              <div className={styles.panelLogEmpty}>No events yet.</div>
            ) : (
              log.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>

          <button className={styles.panelReset} onClick={resetDemo}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
