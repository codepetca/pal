"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

const TEST_LEARNER_ID = "test-learner-001";

const PANEL_EVENTS = [
  { label: "Assignment completed", event_type: "assignment.completed", metadata: { on_time: false } },
  { label: "Assignment completed (on time)", event_type: "assignment.completed", metadata: { on_time: true } },
  { label: "Daily check-in", event_type: "daily_checkin.created", metadata: {} },
];

function Pet() {
  return (
    <svg viewBox="0 0 120 125" xmlns="http://www.w3.org/2000/svg" width="90" height="94">
      <path d="M 88 100 Q 108 76 100 58" stroke="#E76F51" strokeWidth="10" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="96" rx="36" ry="30" fill="#F4A261" />
      <ellipse cx="60" cy="96" rx="22" ry="18" fill="#FBBF8A" />
      <circle cx="60" cy="56" r="34" fill="#F4A261" />
      <polygon points="38,30 31,4 56,22" fill="#E76F51" />
      <polygon points="82,30 89,4 64,22" fill="#E76F51" />
      <polygon points="40,28 35,11 54,23" fill="#FFBBA0" />
      <polygon points="80,28 85,11 66,23" fill="#FFBBA0" />
      <circle cx="47" cy="51" r="6" fill="#2D1B0E" />
      <circle cx="73" cy="51" r="6" fill="#2D1B0E" />
      <circle cx="50" cy="48" r="2.5" fill="white" />
      <circle cx="76" cy="48" r="2.5" fill="white" />
      <ellipse cx="60" cy="62" rx="3.5" ry="3" fill="#E76F51" />
      <path d="M 52 67 Q 60 74 68 67" stroke="#2D1B0E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function WorldView() {
  const [streak, setStreak] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    refreshWorld();
  }, []);

  async function refreshWorld() {
    const res = await fetch(`/api/v1/world/${TEST_LEARNER_ID}`);
    const data = await res.json();
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
        <div className={styles.hudRight}>
          <span className={styles.levelBadge}>Lv 3</span>
          <span className={styles.streak}>🔥 {streak}</span>
        </div>
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
