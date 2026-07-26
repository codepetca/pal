"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./page.module.css";

const TEST_LEARNER_ID = "test-learner-001";

// What the engine charges for one level (LEVEL_UP_COST_XP in @pal/engine's default
// rule pack). Mirrored here only to render the HUD's progress readout — the engine
// remains the sole authority on when a level-up actually fires.
const LEVEL_UP_COST_XP = 500;

// The two frames of a mood alternate at this interval. Deliberately slow for a
// sprite animation: each pose has to register as its own drawing rather than
// blending into the next.
const MOOD_FRAME_MS = 600;

// A blink plays blinking-1..5 in sequence, then rests. The art is authored as a
// ping-pong — frame 5 is byte-identical to frame 1 and frame 4 to frame 2, with
// frame 3 the closed-eye peak — and frame 1 matches default.png, so the sequence
// enters and leaves the resting pose without a visible cut.
const BLINK_FRAME_MS = 70;
const BLINK_EVERY_MS = 4000;

// `dx` is a horizontal nudge in the frame's own canvas pixels, applied on top of
// centring the canvas. The poses are drawn on canvases of different widths and the
// cat is not centred identically on each, so centring the canvas alone — the obvious
// thing — leaves the happy poses ~6.5px right of the resting one at render size,
// which reads as a jitter every time the mood changes.
//
// Deriving these for new art: lay the frame over default.png with the two canvases
// centred and their bottoms flush, then find the horizontal shift that maximises the
// overlap of the two alpha masks. That shift is `dx`. Both frames of a pose should
// come out the same — they do here, which is what shows the offset belongs to the
// canvas rather than the pose; if they disagree, the two frames are drawn
// inconsistently and the art is worth fixing rather than compensating for in code.
// Vertically the canvases already agree, so bottom-flush needs no correction.
type Frame = { src: string; w: number; h: number; dx: number };

// Every frame shares a 2048px canvas height; the widths differ because the wider
// poses (excited most of all) need the room. Declaring the true intrinsic size
// per frame keeps next/image from guessing an aspect ratio before load.
const REST: Frame = { src: "/assets/pets/default.png", w: 1952, h: 2048, dx: 0 };

const BLINK_FRAMES: Frame[] = [1, 2, 3, 4, 5].map((n) => ({
  src: `/assets/pets/blinking-${n}.png`,
  w: 1952,
  h: 2048,
  dx: 0,
}));

// Moods the engine can put the pet in, mapped to their animation frames. A mood
// with no entry here (currently only "neutral") falls back to the resting pose.
const MOOD_FRAMES: Record<string, Frame[]> = {
  happy: [1, 2].map((n) => ({ src: `/assets/pets/happy-${n}.png`, w: 2126, h: 2048, dx: -64 })),
  excited: [1, 2].map((n) => ({ src: `/assets/pets/excited-${n}.png`, w: 2502, h: 2048, dx: -16 })),
};

// Every frame is mounted at once and switched by opacity. Swapping the `src` of a
// single <img> instead would fetch mid-animation and flash an empty box on the
// first pass through each pose.
const ALL_FRAMES: Frame[] = [REST, ...BLINK_FRAMES, ...Object.values(MOOD_FRAMES).flat()];

const PANEL_EVENTS = [
  { label: "Assignment completed", event_type: "assignment.completed", metadata: { on_time: false } },
  { label: "Assignment completed (on time)", event_type: "assignment.completed", metadata: { on_time: true } },
  { label: "Daily check-in", event_type: "daily_checkin.created", metadata: {} },
];

type WorldResponse = {
  pet: { mood: string; animation_state: string };
  world: { stage: number; objects: string[] };
  economy: { xp: number; xp_lifetime: number; level: number; streak: number };
};

// The pet, driven entirely by the mood the engine reports. Three cases:
//
//   mood has frames  → alternate them forever (happy, excited)
//   mood has none    → rest on default.png and blink periodically (neutral)
//   unknown mood     → treated as the resting case, so a rule pack inventing a
//                      mood degrades to a still pet rather than an empty box
//
// Nothing here decides *when* a mood changes — that is the engine's job, and this
// component only ever reads the result.
function PetSprite({ mood }: { mood: string }) {
  const frames = MOOD_FRAMES[mood];
  const [moodFrame, setMoodFrame] = useState(0);
  const [blinkFrame, setBlinkFrame] = useState(-1);

  // The two-frame mood loop. Restarting at frame 0 on every mood change means a
  // new mood always opens on its first pose.
  useEffect(() => {
    setMoodFrame(0);
    if (!frames) return;
    const id = setInterval(() => setMoodFrame((f) => (f + 1) % frames.length), MOOD_FRAME_MS);
    return () => clearInterval(id);
  }, [frames]);

  // Idle blinking, and only idle — the happy and excited art has no blink frames,
  // and a pet already animating a mood does not need a second animation on top.
  useEffect(() => {
    setBlinkFrame(-1);
    if (frames) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // One chained timeout rather than an interval per frame, so a mood change
    // mid-blink cancels the whole sequence instead of leaving strays queued.
    const step = (i: number) => {
      if (cancelled) return;
      if (i >= BLINK_FRAMES.length) {
        setBlinkFrame(-1);
        timer = setTimeout(() => step(0), BLINK_EVERY_MS);
        return;
      }
      setBlinkFrame(i);
      timer = setTimeout(() => step(i + 1), BLINK_FRAME_MS);
    };

    timer = setTimeout(() => step(0), BLINK_EVERY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [frames]);

  const activeSrc = frames
    ? frames[moodFrame].src
    : blinkFrame >= 0
      ? BLINK_FRAMES[blinkFrame].src
      : REST.src;

  return (
    // The stack as a whole is the image; the individual frames are an
    // implementation detail, so they carry an empty alt and the label lives here.
    <div className={styles.pet} role="img" aria-label={`Pet mood: ${mood}`}>
      {ALL_FRAMES.map((frame) => (
        <Image
          key={frame.src}
          src={frame.src}
          alt=""
          width={frame.w}
          height={frame.h}
          priority
          className={styles.petFrame}
          style={{
            opacity: frame.src === activeSrc ? 1 : 0,
            // Both terms are percentages of the frame's own width, so the nudge
            // stays correct at any rendered size.
            transform: `translateX(calc(-50% + ${((frame.dx / frame.w) * 100).toFixed(3)}%))`,
          }}
        />
      ))}
    </div>
  );
}

export default function WorldView() {
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const refreshSeq = useRef(0);

  useEffect(() => {
    // Each page load starts a fresh experiment. The learner store is in-memory and
    // process-local, so without this a refresh would silently inherit the XP, level
    // and mood left behind by the previous session and the run-up to a level-up
    // would be impossible to observe from a known starting point.
    async function startFresh() {
      await fetch("/api/sandbox/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learner_id: TEST_LEARNER_ID }),
      });
      await refreshWorld();
    }
    startFresh();
  }, []);

  async function refreshWorld() {
    const seq = ++refreshSeq.current;
    const res = await fetch(`/api/v1/world/${TEST_LEARNER_ID}`);
    const data: WorldResponse = await res.json();
    // A later refreshWorld() call can have its response arrive first.
    // Drop this one if a newer request has since been issued, so a
    // stale response can't overwrite the current world state.
    if (seq !== refreshSeq.current) return;
    setWorld(data);
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

  const mood = world?.pet.mood ?? "neutral";
  const level = world?.economy.level ?? 1;
  const xp = world?.economy.xp ?? 0;
  const streak = world?.economy.streak ?? 0;

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

      <PetSprite mood={mood} />

      <div className={styles.hud}>
        <span className={styles.logo}>PAL</span>
      </div>

      <div className={styles.groundHud}>
        <span className={styles.moodBadge} data-mood={mood}>
          {mood}
        </span>
        <span className={styles.levelBadge}>Lv {level}</span>
        <span className={styles.xpBadge}>
          ⭐ {xp} / {LEVEL_UP_COST_XP}
        </span>
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
