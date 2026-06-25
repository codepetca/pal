# Data Model

> Living document. Update as the schema evolves.
> Last updated: 2026-06-25

---

## Core entities

- **Integration** — a registered external system (e.g. Pika). Owns its secret, allowed event types, and rule pack.
- **Learner** — a pseudonymous student. No name, no email, no raw ID.
- **LearnerGroup** — a pseudonymous classroom or cohort.
- **Event** — a learning signal received from an integration. Immutable once written.
- **Economy** — XP, level, streak, and event counts per learner.
- **PetState** — current mood, animation, and energy per learner.
- **WorldState** — current stage, unlocked objects, and environment per learner.
- **UnlockLedger** — append-only record of every achievement, badge, and world object unlocked.
- **AuditLog** — record of every rule engine evaluation and its mutations.

## Asset registry entities

- **AssetBundle** — a versioned asset (pet animation, world object, badge, background).
- **RulePack** — a versioned set of rules defining what events cause what changes.
- **WorldTemplate** — the base configuration for a world (stages, default objects, default rule pack).
- **Schedule** — a future timestamp that fires a synthetic event for all learners in an integration or group.

---

> Full schema (column-level detail, indexes, foreign keys) coming in Milestone 1.
