# Architecture Overview

> Living document. Update this as decisions are made and designs evolve.
> Last updated: 2026-07-04

---

## The one-sentence version

Pal is a **game engine as a service**: external systems send it privacy-safe learning signals, and it maintains a persistent pet + evolving world per student.

---

## End-to-end example

A student submits an assignment in Pika. Here is everything that happens:

1. **Pika backend** sends a signal to Pal:
   ```json
   POST /api/events
   {
     "idempotency_key": "pika-assignment-abc123",
     "learner_id": "hashed-student-id",
     "event_type": "assignment.completed",
     "metadata": { "on_time": true }
   }
   ```

2. **Event service** (`events/` domain) validates the request, checks the idempotency key hasn't been seen before, and saves the event to the database.

3. **Rule engine** (`events/` domain) runs the rule pack against the event and current learner state. It produces a list of mutations:
   ```
   XP_GRANT: 50
   XP_GRANT: 25   ← on_time bonus
   PET_MOOD: happy for 30 minutes
   ```

4. **Economy service** (`economy/` domain) applies the XP grants — now at 75 XP. Checks if the learner crossed a level threshold. Updates streak because this is an event today.

5. **World service** (`world/` domain) records the pet mood change with an expiry timestamp.

6. **Student loads their world** — the frontend (`frontend/` domain) calls `GET /api/world/:learner_id`. The pet is bouncing. XP bar has moved. If the student had hit a 7-day streak, a bird would have appeared in their world.

That's the full loop. Each domain owns one step.

---

## Three triggers for world change

Everything in Pal is driven by one of three trigger types:

| Trigger | Who fires it | Example |
|---|---|---|
| **Event-driven** | Integration (e.g. Pika) | Student submits assignment → pet mood changes, XP added |
| **Time-elapsed** | Pal internally | Student active for 30 days → plants grow in world |
| **Scheduled** | Operator configures once | Semester month ends → new world region unlocks for all learners |

All three routes pass through the same rule engine. From the engine's perspective they are identical — just events with different sources.

---

## Three state machines per learner

Each student has three independent pieces of state that evolve in parallel:

```
Pet State          World State         Economy
──────────         ───────────         ───────
mood               stage               XP
animation          objects unlocked    level
energy             environment         streak
                   season/theme        total events
```

Nothing mutates these directly. Only the rule engine produces mutations, and mutations are applied transactionally.

---

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend + API | Next.js (App Router) | One framework for UI and API routes |
| Hosting | Vercel | Serverless functions, zero config deploys |
| Database | TBD — Postgres when needed | Neon is the likely choice when scale requires it |
| Rule engine | TypeScript (`packages/engine`) | Pure functions, no infrastructure |
| Widget | `@pal/widget` | npm package, integrators render it themselves |
| Auth | Deferred to Milestone 2 (M2) | Needed for teacher/operator consoles |

## System layers

```
┌──────────────────────────────────────────────────┐
│               Frontends                          │
│  Student Viewer   Dev Sandbox   Admin Console    │
└────────────────────┬─────────────────────────────┘
                     │ HTTP
┌────────────────────▼─────────────────────────────┐
│                  API Layer                       │
│   /ingest    /world    /integration    /admin    │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│               Service Layer                      │
│  EventService  RuleEngine  WorldEngine           │
│  EconomyService  AchievementService  Scheduler   │
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────┐
│               Data Layer                         │
│  Postgres (primary)    Redis (cache/locks)       │
│  Object storage (assets)                        │
└──────────────────────────────────────────────────┘
```

---

## The two frontends

| Frontend | Who uses it | Purpose |
|---|---|---|
| **Student Viewer** | Students (inside Pika or direct) | See their pet and evolving world |
| **Dev Sandbox** | Developers, operators | Fire test events, preview rules, see world state — no Pika needed |

The sandbox is the student viewer plus an event-firing panel pointed at a test integration. Same codebase, different config.

---

## The rule engine (most important concept)

The rule engine is a **pure function**:

```
(event + current learner state + rule pack) → list of mutations
```

- No side effects
- No database calls inside the engine
- Fully unit-testable with no infrastructure
- All state changes flow through here — nothing else mutates state

Rule packs are JSON config. Operators can tune gameplay (XP amounts, unlock thresholds, world progression) without code changes.

---

## Applying mutations

The engine *produces* mutations; a single **mutation applier** *applies* them. It is the only code that writes learner state, and it owns exactly one database transaction per event:

```
applyMutations(learnerId, mutations)
  → open transaction (locks the learner row — see data-model.md)
  → dispatch each mutation to its domain handler
  → write AuditLog entry
  → commit (or roll back everything)
```

Domains don't apply their own mutations ad hoc — they **register handlers** with the applier:

| Handler | Domain | Mutation types |
|---|---|---|
| Economy handler | `economy/` | `XP_GRANT` |
| Pet handler | `world/` | `PET_MOOD` |
| World handler | `world/` | `WORLD_STAGE`, `WORLD_UNLOCK` |
| Achievement handler | `economy/` | `ACHIEVEMENT` |
| Nudge handler | `frontend/` | `NUDGE` |

One owner for the transaction means partial application is impossible: either every mutation from an evaluation lands, or none do. Handlers may return **derived events** (see [rule-engine.md](rule-engine.md)), which the applier feeds back through the engine within the same transaction.

---

## Schedules

Operators define a calendar of future events once during integration setup:

```
Fall 2026 semester:
  Oct 1  → fire "calendar.month_end" for all learners in this integration
  Nov 1  → fire "calendar.month_end"
  Jan 15 → fire "calendar.semester_end"
```

A background job fires these automatically. The rule pack defines what each calendar event means for the world. Operators and rule pack authors never need to coordinate after initial setup.

Schedules can be set at the **integration level** (all learners) or **group level** (per classroom), with group taking precedence.

---

## Privacy boundaries

Pal never receives:
- Student names, emails, or raw IDs
- Grades, scores, or rankings
- Student writing, messages, or browsing history

Integrations must hash student IDs before sending. Each integration has an allow-list of permitted event types and metadata fields. Unknown fields are stripped on ingest.

Consent and opt-in are managed by the integrating system (e.g. Pika), not by Pal.

---

## Open decisions

- [ ] Per-group schedule overrides — design TBD
- [ ] Pet template ownership — universal catalog vs. integration-specific skins
- [ ] Group/classroom aggregate views in teacher console — M1 or M2?
- [ ] Event volume thresholds — direct ingest vs. queued processing

---

*See [data-model.md](data-model.md), [rule-engine.md](rule-engine.md), and [integration.md](integration.md) for deeper dives.*
