# Architecture Overview

> Living document. Update this as decisions are made and designs evolve.
> Last updated: 2026-06-25

---

## The one-sentence version

CodePetPal is a **game engine as a service**: external systems send it privacy-safe learning signals, and it maintains a persistent pet + evolving world per student.

---

## Three triggers for world change

Everything in CodePetPal is driven by one of three trigger types:

| Trigger | Who fires it | Example |
|---|---|---|
| **Event-driven** | Integration (e.g. Pika) | Student submits assignment → pet mood changes, XP added |
| **Time-elapsed** | CodePetPal internally | Student active for 30 days → plants grow in world |
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

CodePetPal never receives:
- Student names, emails, or raw IDs
- Grades, scores, or rankings
- Student writing, messages, or browsing history

Integrations must hash student IDs before sending. Each integration has an allow-list of permitted event types and metadata fields. Unknown fields are stripped on ingest.

Consent and opt-in are managed by the integrating system (e.g. Pika), not by CodePetPal.

---

## Open decisions

- [ ] Per-group schedule overrides — design TBD
- [ ] Pet template ownership — universal catalog vs. integration-specific skins
- [ ] Group/classroom aggregate views in teacher console — M1 or M2?
- [ ] Event volume thresholds — direct ingest vs. queued processing

---

*See [data-model.md](data-model.md), [rule-engine.md](rule-engine.md), and [integration.md](integration.md) for deeper dives.*
