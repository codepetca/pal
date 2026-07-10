# Sandbox Control Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating event-firing control panel to the main Pal page (`/`), backed by a minimal in-memory state layer, so firing an event visibly updates Pal's streak counter — replacing the separate `/sandbox` page.

**Architecture:** A new pure function `applyMutations` (packages/engine) applies rule-engine mutations to a `LearnerState` and detects when a streak crosses 7 (emitting a derived `STREAK_MILESTONE` event, per the cascade rule in `docs/rule-engine.md`). A new in-memory store (apps/web) orchestrates `evaluate()` + `applyMutations()` per learner, standing in for the real DB until M1. The existing API routes are wired to that store instead of stub/hardcoded responses, and the main page gets a small toggleable panel that calls them.

**Tech Stack:** TypeScript, Next.js 15 (App Router, Turbopack), React 19, `node:test` + `tsx` for engine unit tests, pnpm workspaces (`@pal/engine`, `@pal/web`).

## Global Constraints

- Nothing mutates learner state except the rule engine — `applyMutations` is the only place economy/pet/world fields change (CLAUDE.md).
- No real database. State lives in a server-side in-memory `Map`, reset on server restart (spec non-goal).
- No pet SVG/mood visual changes this round — mood is tracked in state only (spec non-goal).
- No world-unlock UI and no world-stage control — tracked in state only (spec non-goal).
- No idempotency-key dedup, no event-type allow-list validation, no row-level locking (spec non-goal — real DB/M1 concerns).
- No dynamic level badge — `Lv 3` stays literal text (spec non-goal).
- `POST /api/v1/events` response contract is unchanged: `200 {"status":"processed"}`, `401` unauthorized, `422` missing fields (docs/api.md).
- The streak badge will read `🔥 0` on first load (in-memory store starts empty) until events are fired — confirmed acceptable with the user.
- Work happens directly on the `sandbox` branch (already checked out locally, tracking `origin/sandbox`). Never commit to `main`.

---

### Task 1: `applyMutations` pure function in the rule engine

**Files:**
- Create: `packages/engine/src/apply.ts`
- Create: `packages/engine/src/apply.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Consumes: `LearnerState`, `Mutation`, `IncomingEvent` types from `packages/engine/src/types.ts` (already defined).
- Produces: `applyMutations(state: LearnerState, mutations: Mutation[], occurredAt: string): { state: LearnerState; derivedEvents: IncomingEvent[] }` — exported from `@pal/engine`. Task 2 (`learner-store.ts`) calls this directly.

- [ ] **Step 1: Write the failing test file**

Create `packages/engine/src/apply.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMutations } from "./apply";
import type { LearnerState, Mutation } from "./types";

const baseState: LearnerState = {
  economy: { xp: 0, level: 1, streak_current: 0, last_event_at: null },
  pet: { mood: "neutral", mood_expires_at: null },
  world: { stage: 0, unlocked_object_ids: [] },
};

const OCCURRED_AT = "2026-07-10T12:00:00.000Z";

describe("applyMutations", () => {
  it("adds XP_GRANT amounts to economy.xp", () => {
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 50 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.xp, 50);
  });

  it("increments streak_current by exactly 1 per call, even with multiple XP_GRANT mutations", () => {
    const mutations: Mutation[] = [
      { type: "XP_GRANT", amount: 50 },
      { type: "XP_GRANT", amount: 25 },
    ];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.xp, 75);
    assert.equal(state.economy.streak_current, 1);
  });

  it("does not touch streak_current when no XP_GRANT is present", () => {
    const mutations: Mutation[] = [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.economy.streak_current, 0);
  });

  it("sets pet mood and computes mood_expires_at from occurred_at + duration_minutes", () => {
    const mutations: Mutation[] = [{ type: "PET_MOOD", mood: "happy", duration_minutes: 30 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.pet.mood, "happy");
    assert.equal(state.pet.mood_expires_at, "2026-07-10T12:30:00.000Z");
  });

  it("adds a world unlock id", () => {
    const mutations: Mutation[] = [{ type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("does not duplicate a world unlock id that is already present", () => {
    const stateWithUnlock: LearnerState = {
      ...baseState,
      world: { stage: 0, unlocked_object_ids: ["world-bird-v1"] },
    };
    const mutations: Mutation[] = [{ type: "WORLD_UNLOCK", asset_ref_id: "world-bird-v1" }];
    const { state } = applyMutations(stateWithUnlock, mutations, OCCURRED_AT);
    assert.deepEqual(state.world.unlocked_object_ids, ["world-bird-v1"]);
  });

  it("sets world stage", () => {
    const mutations: Mutation[] = [{ type: "WORLD_STAGE", stage: 2 }];
    const { state } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.equal(state.world.stage, 2);
  });

  it("derives a STREAK_MILESTONE event when streak crosses from below 7 to 7 or above", () => {
    const stateAtSix: LearnerState = {
      ...baseState,
      economy: { xp: 0, level: 1, streak_current: 6, last_event_at: null },
    };
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { state, derivedEvents } = applyMutations(stateAtSix, mutations, OCCURRED_AT);
    assert.equal(state.economy.streak_current, 7);
    assert.deepEqual(derivedEvents, [
      { event_type: "STREAK_MILESTONE", occurred_at: OCCURRED_AT, metadata: {} },
    ]);
  });

  it("does not derive a STREAK_MILESTONE event when streak stays below 7", () => {
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { derivedEvents } = applyMutations(baseState, mutations, OCCURRED_AT);
    assert.deepEqual(derivedEvents, []);
  });

  it("does not re-derive a STREAK_MILESTONE event when streak is already at or above 7", () => {
    const stateAtSeven: LearnerState = {
      ...baseState,
      economy: { xp: 0, level: 1, streak_current: 7, last_event_at: null },
    };
    const mutations: Mutation[] = [{ type: "XP_GRANT", amount: 10 }];
    const { derivedEvents } = applyMutations(stateAtSeven, mutations, OCCURRED_AT);
    assert.deepEqual(derivedEvents, []);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @pal/engine test`
Expected: FAIL — `Cannot find module './apply'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/apply.ts`:

```ts
import type { IncomingEvent, LearnerState, Mutation } from "./types";

const STREAK_MILESTONE = 7;

// Applies a batch of mutations produced by one evaluate() call to a
// learner's state. Pure — no DB, no side effects. The only place
// economy/pet/world fields are allowed to change.
export function applyMutations(
  state: LearnerState,
  mutations: Mutation[],
  occurredAt: string
): { state: LearnerState; derivedEvents: IncomingEvent[] } {
  const next: LearnerState = {
    economy: { ...state.economy },
    pet: { ...state.pet },
    world: { ...state.world, unlocked_object_ids: [...state.world.unlocked_object_ids] },
  };

  let grantedXp = false;

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "XP_GRANT":
        next.economy.xp += mutation.amount;
        grantedXp = true;
        break;
      case "PET_MOOD": {
        next.pet.mood = mutation.mood;
        const expiresAt = new Date(occurredAt);
        expiresAt.setMinutes(expiresAt.getMinutes() + mutation.duration_minutes);
        next.pet.mood_expires_at = expiresAt.toISOString();
        break;
      }
      case "WORLD_UNLOCK":
        if (!next.world.unlocked_object_ids.includes(mutation.asset_ref_id)) {
          next.world.unlocked_object_ids.push(mutation.asset_ref_id);
        }
        break;
      case "WORLD_STAGE":
        next.world.stage = mutation.stage;
        break;
      case "ACHIEVEMENT":
      case "NUDGE":
        // Not modeled in LearnerState yet — no-op until badges/nudges exist.
        break;
    }
  }

  // A single evaluate() call can contain multiple XP_GRANT mutations
  // (e.g. assignment-xp + assignment-on-time-bonus both fire for one
  // event) — that must still only count as one streak tick.
  if (grantedXp) {
    next.economy.streak_current += 1;
  }
  next.economy.last_event_at = occurredAt;

  const derivedEvents: IncomingEvent[] = [];
  if (state.economy.streak_current < STREAK_MILESTONE && next.economy.streak_current >= STREAK_MILESTONE) {
    derivedEvents.push({ event_type: "STREAK_MILESTONE", occurred_at: occurredAt, metadata: {} });
  }

  return { state: next, derivedEvents };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @pal/engine test`
Expected: PASS — all `applyMutations` tests green, plus the existing `evaluate.test.ts` suite still passing.

- [ ] **Step 5: Export `applyMutations` from the package**

Modify `packages/engine/src/index.ts`:

```ts
export { evaluate } from "./evaluate";
export { applyMutations } from "./apply";
export { defaultRulePack } from "./default-rules";
export type { IncomingEvent, LearnerState, Mutation, Rule, RulePack } from "./types";
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @pal/engine typecheck`
Expected: no errors.

```bash
git add packages/engine/src/apply.ts packages/engine/src/apply.test.ts packages/engine/src/index.ts
git commit -m "Add applyMutations pure function to the rule engine"
```

---

### Task 2: In-memory learner store

**Files:**
- Create: `apps/web/src/lib/learner-store.ts`

**Interfaces:**
- Consumes: `evaluate`, `applyMutations`, `defaultRulePack`, `IncomingEvent`, `LearnerState` from `@pal/engine` (Task 1).
- Produces: `applyEvent(learnerId: string, event: IncomingEvent): LearnerState`, `getLearnerState(learnerId: string): LearnerState`, `resetLearner(learnerId: string): void` — Task 3's API routes call these directly.

> No automated test runner exists in `apps/web` (only `next lint`/`typecheck`/`build`/`dev` scripts — see `apps/web/package.json`). Adding one is out of scope for this change. This module is verified manually end-to-end in Task 5.

- [ ] **Step 1: Write the module**

Create `apps/web/src/lib/learner-store.ts`:

```ts
import { applyMutations, defaultRulePack, evaluate } from "@pal/engine";
import type { IncomingEvent, LearnerState } from "@pal/engine";

// In-memory placeholder for the real DB, coming in M1. Resets whenever
// the dev server restarts. Keyed by learner_id.
const store = new Map<string, LearnerState>();

const MAX_CASCADE_DEPTH = 3;

function defaultState(): LearnerState {
  return {
    economy: { xp: 0, level: 1, streak_current: 0, last_event_at: null },
    pet: { mood: "neutral", mood_expires_at: null },
    world: { stage: 0, unlocked_object_ids: [] },
  };
}

function applyAtDepth(learnerId: string, event: IncomingEvent, depth: number): LearnerState {
  const state = store.get(learnerId) ?? defaultState();
  const mutations = evaluate(event, state, defaultRulePack);
  const { state: nextState, derivedEvents } = applyMutations(state, mutations, event.occurred_at);
  store.set(learnerId, nextState);

  // Depth limit matches the cascade rule in docs/rule-engine.md: original
  // event -> derived -> derived -> stop.
  if (depth < MAX_CASCADE_DEPTH) {
    for (const derived of derivedEvents) {
      applyAtDepth(learnerId, derived, depth + 1);
    }
  }

  return store.get(learnerId) as LearnerState;
}

export function applyEvent(learnerId: string, event: IncomingEvent): LearnerState {
  return applyAtDepth(learnerId, event, 0);
}

export function getLearnerState(learnerId: string): LearnerState {
  return store.get(learnerId) ?? defaultState();
}

export function resetLearner(learnerId: string): void {
  store.delete(learnerId);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pal/web typecheck`
Expected: no errors. (This will fail until `@pal/engine`'s `apply.ts` export from Task 1 is in place — confirm Task 1 is committed first.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/learner-store.ts
git commit -m "Add in-memory learner store standing in for the DB until M1"
```

---

### Task 3: Wire the API routes to the learner store

**Files:**
- Modify: `apps/web/src/app/api/v1/events/route.ts`
- Modify: `apps/web/src/app/api/v1/world/[learnerId]/route.ts`
- Create: `apps/web/src/app/api/sandbox/reset/route.ts`

**Interfaces:**
- Consumes: `applyEvent`, `getLearnerState`, `resetLearner` from `apps/web/src/lib/learner-store.ts` (Task 2).
- Produces: real responses from `POST /api/v1/events`, `GET /api/v1/world/:learnerId`, `POST /api/sandbox/reset` — Task 4's frontend panel calls these (the first two indirectly via the existing `/api/sandbox/events` proxy).

- [ ] **Step 1: Wire event ingest to the store**

Modify `apps/web/src/app/api/v1/events/route.ts` — replace the TODO-only body with a real call. Full file after the change:

```ts
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedIngest } from "@/lib/ingest-auth";
import { applyEvent } from "@/lib/learner-store";

// POST /api/v1/events
// Receives a learning signal from an integration (e.g. Pika).
// See docs/api.md for the full contract.
export async function POST(req: NextRequest) {
  if (!isAuthorizedIngest(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const { idempotency_key, learner_id, event_type, occurred_at, metadata } = body;

  if (!idempotency_key || !learner_id || !event_type || !occurred_at) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 422 });
  }

  // TODO: check idempotency key against DB — return "duplicate" if seen
  // TODO: validate event_type against integration allow-list
  // TODO: save the raw event to DB (only derived state is persisted, in-memory, for now)
  applyEvent(learner_id, { event_type, occurred_at, metadata: metadata ?? {} });

  return NextResponse.json({ status: "processed" });
}
```

- [ ] **Step 2: Serve real state from the world route**

Modify `apps/web/src/app/api/v1/world/[learnerId]/route.ts`. Full file after the change:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getLearnerState } from "@/lib/learner-store";

// GET /api/v1/world/:learnerId
// Returns current pet state, world state, and economy for a learner.
// See docs/api.md for the full contract.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ learnerId: string }> }
) {
  const { learnerId } = await params;
  const state = getLearnerState(learnerId);

  // TODO: validate read token from Authorization header

  return NextResponse.json({
    learnerId,
    pet: { mood: state.pet.mood, animation_state: "idle" },
    world: { stage: state.world.stage, objects: state.world.unlocked_object_ids },
    economy: { xp: state.economy.xp, level: state.economy.level, streak: state.economy.streak_current },
  });
}
```

- [ ] **Step 3: Add the dev-only reset endpoint**

Create `apps/web/src/app/api/sandbox/reset/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { resetLearner } from "@/lib/learner-store";

// POST /api/sandbox/reset
// Dev-only: clears a learner's in-memory state so the sandbox panel can
// be replayed from scratch without restarting the dev server. Not part
// of the real API contract in docs/api.md.
export async function POST(req: NextRequest) {
  const { learner_id } = await req.json();

  if (!learner_id) {
    return NextResponse.json({ error: "missing_learner_id" }, { status: 422 });
  }

  resetLearner(learner_id);
  return NextResponse.json({ status: "reset" });
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @pal/web typecheck`
Expected: no errors.

```bash
git add apps/web/src/app/api/v1/events/route.ts apps/web/src/app/api/v1/world/[learnerId]/route.ts apps/web/src/app/api/sandbox/reset/route.ts
git commit -m "Wire event ingest and world routes to the in-memory learner store"
```

---

### Task 4: Floating control panel on the main page

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.module.css`
- Delete: `apps/web/src/app/sandbox/page.tsx` (and the now-empty `apps/web/src/app/sandbox/` directory)

**Interfaces:**
- Consumes: `GET /api/v1/world/:learnerId`, `POST /api/sandbox/events` (existing proxy, unchanged), `POST /api/sandbox/reset` (Task 3).
- Produces: the page the user interacts with. No other task depends on this one.

- [ ] **Step 1: Replace `page.tsx` with the client-component version**

The `<Pet />` SVG, ground SVG, and HUD markup/positioning are unchanged from today — only the HUD's streak value becomes dynamic, the `sandbox →` link is removed, and the toggle button + panel are added. Full file:

```tsx
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
```

- [ ] **Step 2: Add panel styles, remove the now-unused sandbox link style**

Modify `apps/web/src/app/page.module.css` — remove the `.sandboxLink` rule (its element no longer exists) and append the panel styles. Full file after the change:

```css
.world {
  position: relative;
  width: 100%;
  height: 100vh;
  background: linear-gradient(to bottom, #5B9BD5 0%, #A8CCE8 55%, #D9EAF5 100%);
  overflow: hidden;
  font-family: system-ui, -apple-system, sans-serif;
}

.ground {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 36%;
  pointer-events: none;
}

.pet {
  position: absolute;
  bottom: 22%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
}

.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: white;
  letter-spacing: 2px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

.hudRight {
  display: flex;
  align-items: center;
  gap: 8px;
}

.levelBadge {
  background: rgba(255,255,255,0.9);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #2D1B0E;
}

.streak {
  background: rgba(255,255,255,0.9);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #2D1B0E;
}

.panelToggle {
  position: absolute;
  top: 60px;
  left: 20px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(20,24,32,0.55);
  color: white;
  font-size: 16px;
  cursor: pointer;
  z-index: 11;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}

.panel {
  position: absolute;
  top: 104px;
  left: 20px;
  width: 170px;
  background: rgba(20,24,32,0.62);
  backdrop-filter: blur(6px);
  border-radius: 10px;
  color: #eef1f6;
  padding: 10px;
  font-size: 11px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}

.panelHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  font-size: 12px;
}

.panelClose {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  font-size: 12px;
}

.panelButtons {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.panelButton {
  font-size: 10px;
  padding: 5px 8px;
  background: rgba(255,255,255,0.12);
  border: none;
  border-radius: 4px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.panelLogLabel {
  opacity: 0.6;
  font-size: 9px;
  letter-spacing: 1px;
  margin-top: 4px;
}

.panelLog {
  font-size: 9.5px;
  opacity: 0.85;
  line-height: 1.5;
  max-height: 60px;
  overflow-y: auto;
}

.panelLogEmpty {
  opacity: 0.6;
}

.panelReset {
  font-size: 9.5px;
  padding: 4px 6px;
  background: rgba(255,90,90,0.25);
  border: none;
  border-radius: 4px;
  color: inherit;
  text-align: center;
  cursor: pointer;
  margin-top: 4px;
}
```

- [ ] **Step 3: Delete the standalone sandbox page**

```bash
rm apps/web/src/app/sandbox/page.tsx
rmdir apps/web/src/app/sandbox
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @pal/web typecheck`
Expected: no errors.

```bash
git add apps/web/src/app/page.tsx apps/web/src/app/page.module.css
git add -u apps/web/src/app/sandbox
git commit -m "Add floating event control panel to the main page, remove /sandbox"
```

---

### Task 5: End-to-end manual verification

**Files:** none (verification only)

> Prerequisite: `apps/web/.env.local` must contain `SANDBOX_INTEGRATION_SECRET` — without it, `/api/sandbox/events` returns a `500` (`sandbox_not_configured`) and every button click will log `→ event_type: error`. This file already exists locally; it's gitignored and won't be committed.

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: `apps/web` compiles and serves at `http://localhost:3000` with no errors in the terminal.

- [ ] **Step 2: Confirm the baseline visuals are unchanged**

Open `http://localhost:3000`. Confirm: gradient sky, ground, centered pet SVG, `PAL` logo top-left, `Lv 3` badge — all identical to before this change. The streak badge should read `🔥 0` (expected per the "known behavior change" in the spec — the in-memory store starts empty).

- [ ] **Step 3: Confirm the panel toggles without moving the pet**

Click the ⚡ icon near the top-left. Confirm the glass panel appears without shifting or covering the centered pet, and that it lists 3 buttons, an empty "Log" section ("No events yet."), and a "Reset" button. Click ✕ (or the ⚡ icon again) and confirm it closes.

- [ ] **Step 4: Confirm firing an event updates the streak badge and log**

Open the panel, click "Daily check-in". Confirm: a `→ daily_checkin.created: processed` line appears in the log, and the `🔥` badge in the HUD increments from `0` to `1`.

- [ ] **Step 5: Confirm the on-time bonus still counts as one streak tick**

Click "Assignment completed (on time)". Confirm the badge increments by exactly `1` (not `2`) — this is the Task 1 fix for the double-`XP_GRANT` case.

- [ ] **Step 6: Confirm the streak-7 unlock fires (API-level check)**

Click event buttons until the badge reads `7` (5 more clicks after Step 5, any combination). Then, in a terminal, run:

```bash
curl http://localhost:3000/api/v1/world/test-learner-001
```

Expected: the JSON response's `world.objects` array includes `"world-bird-v1"` (confirms the derived `STREAK_MILESTONE` cascade applied the unlock — there's no UI for this yet, per the spec's non-goals).

- [ ] **Step 7: Confirm reset works**

Click "Reset". Confirm the log clears and the streak badge goes back to `🔥 0`.

- [ ] **Step 8: Confirm `/sandbox` is gone**

Navigate to `http://localhost:3000/sandbox`. Expected: Next.js 404 page.

- [ ] **Step 9: Final check and push reminder**

Run: `pnpm typecheck` (repo root, runs all packages via turbo)
Expected: no errors.

No commit needed for this task (verification only). Once confirmed, the user can decide when to push `sandbox` to `origin` — do not push without being asked.
