"use client";

import { useState } from "react";

const TEST_LEARNER_ID = "test-learner-001";

const TEST_EVENTS = [
  { label: "Assignment completed", event_type: "assignment.completed", metadata: { on_time: false } },
  { label: "Assignment completed on time", event_type: "assignment.completed", metadata: { on_time: true } },
  { label: "Daily check-in", event_type: "daily_checkin.created", metadata: {} },
];

type WorldState = {
  pet: { mood: string; animation_state: string };
  world: { stage: number; objects: string[] };
  economy: { xp: number; level: number; streak: number };
};

export default function SandboxPage() {
  const [world, setWorld] = useState<WorldState | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function fireEvent(event_type: string, metadata: Record<string, unknown>) {
    const idempotency_key = `sandbox-${Date.now()}`;
    const res = await fetch("/api/events", {
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
    setLog((prev) => [`→ ${event_type}: ${data.status}`, ...prev]);
    await refreshWorld();
  }

  async function refreshWorld() {
    const res = await fetch(`/api/world/${TEST_LEARNER_ID}`);
    const data = await res.json();
    setWorld(data);
  }

  return (
    <main style={{ fontFamily: "monospace", padding: "2rem", maxWidth: "600px" }}>
      <h1>Dev Sandbox</h1>
      <p>Fire test events and watch state update. No Pika connection needed.</p>

      <section>
        <h2>Fire an event</h2>
        {TEST_EVENTS.map((e) => (
          <button
            key={e.event_type + e.label}
            onClick={() => fireEvent(e.event_type, e.metadata)}
            style={{ display: "block", margin: "0.5rem 0", padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            {e.label}
          </button>
        ))}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Current state</h2>
        {world ? (
          <pre>{JSON.stringify(world, null, 2)}</pre>
        ) : (
          <p>Fire an event to see state.</p>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Event log</h2>
        {log.length === 0 ? <p>No events yet.</p> : log.map((l, i) => <div key={i}>{l}</div>)}
      </section>
    </main>
  );
}
