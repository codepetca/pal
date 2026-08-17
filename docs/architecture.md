# Architecture Overview

> Living document. Update this as decisions are made and designs evolve.
> Last updated: 2026-08-16

---

## The one-sentence version

Pal is a **game engine as a service**: external systems send it privacy-safe learning signals, and it maintains a persistent pet + evolving world per student.

---

## End-to-end example

A student submits an assignment in Pika. Here is everything that happens:

1. **Pika backend** sends a signal to Pal:
   ```json
   POST /api/v1/events
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
   XP_GRANT: 75
   XP_GRANT: 25   ← on_time bonus
   PET_MOOD: happy for 30 minutes
   ```

4. **Economy service** (`economy/` domain) applies the 100 XP total and emits an
   `XP_CHANGED` derived event. The applier feeds that back through the rule engine,
   where the `level-up` rule decides whether the learner crossed a threshold. The
   policy lives in `packages/engine/src/progression-policy.ts`; see
   [rule-engine.md](rule-engine.md).

5. **World service** (`world/` domain) records the pet mood change with an expiry timestamp.

6. **Daily story reconciliation** — Vercel wakes Pal's authenticated worker. It
   takes the learner lock and inserts the one due story-ownership ledger row
   without creating a learning event or gameplay mutation.

7. **Student loads their world** — the frontend (`frontend/` domain) calls the authenticated `GET /api/v1/learner/snapshot` route with a short-lived learner-scoped token. The pet is bouncing and the XP bar has moved. The due weekly story is a sketch keepsake unless that week's durable Weekly Rhythm brings the same item to life in color.

That's the full loop. Each domain owns one step.

---

## Three triggers for world change

Everything in Pal is driven by one of three trigger types:

| Trigger | Who fires it | Example |
|---|---|---|
| **Event-driven** | Integration (e.g. Pika) | Student submits assignment → pet mood changes, XP added |
| **Time-elapsed** | Pal internally | Student active for 30 days → plants grow in world |
| **Scheduled** | Operator configures once | Semester month ends → new world region unlocks for all learners |

Gameplay changes from all three trigger types pass through the same rule engine.
The story scheduler is narrower: it reconciles an already-selected ownership
ledger under the same learner lock and deliberately emits no synthetic activity,
achievement, or XP event.

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
| Widget | `@codepet/pal-widget` | npm package, integrators render it themselves |
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

The sandbox is the student viewer plus a scenario panel. Public PR previews use a
fresh in-memory snapshot; optional local persisted mode points the same panel at an
isolated test integration. Same widget codebase, different client configuration.

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
processEvent(event, state, rulePack)
  → evaluate the event against the rule pack
  → dispatch each mutation to its domain handler
  → collect the derived events the handlers emit
  → re-evaluate each derived event, up to the depth limit
  → return the settled state + the full trace
```

`processEvent` is pure — state in, state out — so the whole cascade is unit-testable with no infrastructure. The caller owns persistence and wraps it in one transaction that locks the learner row (see [data-model.md](data-model.md)) and writes the trace to the AuditLog.

> **M1 status:** the ingest route calls `processEventInDb`, which locks the learner row, inserts the event with constraint-backed deduplication, applies the engine, and persists economy, pet, and world state in one PostgreSQL transaction. Persisting the full mutation trace to the AuditLog remains future work.

Domains don't apply their own mutations ad hoc — they **register handlers** with the applier:

| Handler | Domain | Mutation types | Derived events it emits |
|---|---|---|---|
| Economy handler | `economy/` | `XP_GRANT`, `LEVEL_GRANT`, `STREAK` | `XP_CHANGED`, `LEVEL_UP`, `STREAK_MILESTONE` |
| Pet handler | `world/` | `PET_MOOD` | — |
| World handler | `world/` | `WORLD_STAGE`, `WORLD_UNLOCK` | — |
| Achievement handler | `economy/` | `ACHIEVEMENT` | — |
| Nudge handler | `frontend/` | `NUDGE` | — |

One owner for the transaction means partial application is impossible: either every mutation from an evaluation lands, or none do. Handlers may return **derived events** (see [rule-engine.md](rule-engine.md)), which the applier feeds back through the engine within the same transaction.

The same transaction may also emit persistence-authorized internal events after a
durable transition succeeds. `DAILY_LOG_REWARD_SETTLED` follows the first insert of
a daily settlement marker, and `WEEKLY_RHYTHM_EARNED` follows the first earned
achievement transition. Neither is accepted from an integration.

---

## Schedules

### Guaranteed weekly story collectible

`apps/web/vercel.json` declares a daily UTC wake-up for the authenticated
`/api/cron/story-collectibles` route. When an authoritative weekly configuration
fact is stored, a database trigger materializes its due boundary in the typed
`story_collectible_schedules` queue using the term's IANA timezone. Friday-ending
weeks become due Saturday, while a midweek final week becomes due the following
day. It never waits for the next instructional week, so holidays and breaks
cannot delay ownership. New malformed calendars fail closed; the migration
backfill safely skips malformed legacy rows.

The worker pages through the partial pending-due index with a stable
`(due_at, id)` cursor, then reconciles every overdue post-rollout row for each
selected learner. Per-learner transactions, row locks, and the reward ledger's
uniqueness constraint make retries and concurrent event/cron runs safe.
Discovery and learner transactions retry transient failures up to a small fixed
attempt limit during the same invocation. A short transaction-local lock timeout
prevents a concurrent event from consuming the connection's full statement
timeout; terminal learner failures remain isolated from the rest of the batch.
Pending queue rows survive missed daily invocations and are consumed only after
the ownership ledger contains the matching collectible.

### Future operator schedules

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
