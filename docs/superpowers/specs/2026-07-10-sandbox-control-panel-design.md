# Sandbox control panel on the main Pal page

> Branch: `sandbox`. Design doc — implementation plan comes next.

## Goal

Today the dev sandbox (`/sandbox`) fires test events but lives on a separate page, and the main page (`/`) only ever shows a static, hardcoded pet/HUD — firing an event has no visible effect on it because there is no state layer wired up yet (`/api/v1/events` is a stub, `/api/v1/world/[learnerId]` always returns the same hardcoded object; `packages/db` doesn't exist yet).

This change moves event-firing onto the main page itself, as a small floating control panel, and wires up just enough real state so that firing an event visibly changes Pal (specifically, the streak count) without waiting on the real DB (M1).

## Non-goals

- No real database. State lives in a server-side in-memory `Map`, reset on server restart.
- No pet SVG/mood visual changes — mood is tracked in state but the pet's look doesn't change yet (art is still being drawn).
- No world-unlock UI and no world-stage control — tracked in state only.
- No idempotency-key dedup, no event-type allow-list validation, no row-level locking for concurrency. These are real DB/M1 concerns and unnecessary for a single-user in-memory dev demo.
- No dynamic level badge — nothing reads `economy.level` yet, so `Lv 3` stays literal text.

## Architecture

### `packages/engine/src/apply.ts` (new, pure function)

```
applyMutations(state: LearnerState, mutations: Mutation[]): { state: LearnerState; derivedEvents: IncomingEvent[] }
```

- `XP_GRANT` → adds to `economy.xp`. `economy.streak_current` increments by at most 1 **per `applyMutations` call**, not per `XP_GRANT` mutation — a single `assignment.completed (on_time: true)` event matches two rules (`assignment-xp` + `assignment-on-time-bonus`) and yields two `XP_GRANT` mutations in one batch, which must still only count as one streak tick.
- `PET_MOOD` → sets `pet.mood` and computes `pet.mood_expires_at` from `duration_minutes`.
- `WORLD_UNLOCK` → appends `asset_ref_id` to `world.unlocked_object_ids` (de-duped).
- `WORLD_STAGE` → sets `world.stage`.
- `ACHIEVEMENT` / `NUDGE` → no-ops for now (no state field models these; the default rule pack doesn't emit them today).
- Cascade: if `economy.streak_current` crosses 7 (was `< 7`, now `>= 7`), returns a derived `STREAK_MILESTONE` synthetic event in `derivedEvents`, per the cascade rule in `docs/rule-engine.md`.

No side effects, no DB — stays consistent with "nothing mutates state except the rule engine" (CLAUDE.md).

### `apps/web/src/lib/learner-store.ts` (new)

- In-memory `Map<learnerId, LearnerState>`. Missing entries get a fresh default state (`xp: 0`, `level: 1`, `streak_current: 0`, `mood: "neutral"`, `stage: 0`, `unlocked_object_ids: []`).
- `applyEvent(learnerId, event)`:
  1. Look up (or create) state.
  2. `evaluate(event, state, defaultRulePack)` → mutations.
  3. `applyMutations(state, mutations)` → next state + derived events.
  4. For each derived event (depth-limited to 3, per docs/rule-engine.md), recurse: evaluate → apply → collect further derived events.
  5. Store and return the final state.
- `resetLearner(learnerId)` — deletes the entry (next read gets a fresh default).

### `/api/v1/events` (edit)

Replaces its TODOs: after existing validation, calls `learner-store.applyEvent(learner_id, {event_type, occurred_at, metadata})`. Response contract unchanged (`{status: "processed"}`, `401`/`422` as already documented).

### `/api/v1/world/[learnerId]` (edit)

Reads from `learner-store` instead of returning a hardcoded object. Maps the engine's internal `LearnerState` shape to the existing public response shape (`pet.mood`/`pet.animation_state` — animation_state stays `"idle"` static since no mood-visual work this round; `world.stage`/`world.objects` ← `unlocked_object_ids`; `economy.xp`/`level`/`streak` ← `streak_current`).

### `/api/sandbox/reset` (new)

Dev-only POST endpoint (not part of the real API contract — stays under `/api/sandbox/` alongside the existing proxy). Calls `learner-store.resetLearner(learner_id)`.

## Frontend (`apps/web/src/app/page.tsx`)

- Becomes a client component (`"use client"`). The `<Pet />` SVG, ground SVG, gradient background, and HUD layout/positioning are unchanged.
- On mount, fetches `GET /api/v1/world/test-learner-001` and stores `economy.streak` in state; the `🔥` badge renders this value live (replacing the hardcoded `5`). `Lv 3` stays literal text.
- Adds a small ⚡ icon button, fixed near the top-left (below the HUD), that toggles a floating glass panel (~170px wide, translucent dark blurred background, matching the approved mockup) — sized and positioned so it never overlaps the centered pet.
- Panel contents:
  - 3 buttons: "Assignment completed", "Assignment completed (on time)", "Daily check-in" — same event types/metadata the old `/sandbox` page used.
  - A compact scrolling event log (e.g. `→ assignment.completed: processed`).
  - A "Reset" button.
- Firing an event: `POST /api/sandbox/events` (existing proxy, unchanged — still the only thing holding `SANDBOX_INTEGRATION_SECRET`) → on response, append to the log → refetch world state → update the streak badge.
- Reset: `POST /api/sandbox/reset` → clear the log → refetch world state (streak badge goes back to 0).
- `/sandbox/page.tsx` and its API route module are removed... **except** `/api/sandbox/events` (the proxy) is kept — only the standalone *page* and the HUD's `sandbox →` link are deleted.

## Known behavior change

Because the in-memory store starts fresh, the streak badge shows **🔥 0** on first load instead of today's hardcoded **🔥 5**, until events are fired. (Confirmed acceptable with the user.)

## Error handling

- If `SANDBOX_INTEGRATION_SECRET` isn't configured, the existing proxy already returns a `500` with a hint; the panel surfaces this as a log line (e.g. `→ assignment.completed: error`) rather than crashing.
- Local dev requires `apps/web/.env.local` with `SANDBOX_INTEGRATION_SECRET` set (already created for this session).

## Testing

- Unit tests for `applyMutations` in `packages/engine` (alongside `evaluate.test.ts`): XP grant + streak increment, mood set + expiry, unlock de-dupe, streak-crossing-7 cascade emits `STREAK_MILESTONE`, cascade depth limit of 3.
- Manual verification in the dev server: fire each event button, confirm the log and streak badge update; hit reset and confirm it goes back to 0; confirm the pet, ground, gradient, and HUD layout are pixel-identical to today aside from the new icon/panel and the live streak number.
