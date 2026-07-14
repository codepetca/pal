# Data Model

> Living document. Update as the schema evolves.
> Last updated: 2026-07-04

---

## Core entities

- **Integration** — a registered external system (e.g. Pika). Owns its secret, allowed event types, and rule pack.
- **Learner** — a pseudonymous student. No name, no email, no raw ID.
- **LearnerGroup** — a pseudonymous classroom or cohort.
- **Event** — a learning signal received from an integration. Immutable once written.
- **Economy** — XP, level, streak, and event counts per learner. Two XP columns, and the distinction matters:
  - `xp` — the **balance** toward the next level. A level-up spends it (a negative `XP_GRANT`), so it goes down as well as up. This is what a progress bar renders.
  - `xp_lifetime` — every point ever earned, never spent. This is what lifetime achievements key on. Without it, levelling would erase the only record that the XP existed.

  Streak continuity is anchored on `streak_last_day` (the UTC calendar day the streak last advanced), not on `last_event_at` — otherwise any event, like an assignment, would stand in for a daily check-in.
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

## Concurrency

Two events for the same learner can arrive at the same moment and land on two serverless function instances. Without protection, both read the same starting state, both write, and one update is silently lost. Idempotency keys do **not** prevent this — they dedupe *retries of the same event*, not *different concurrent events*.

**Rule: all writes for a learner are serialized through a row lock.** The apply transaction starts with:

```sql
SELECT id FROM learners WHERE id = $1 FOR UPDATE;
```

The second transaction blocks until the first commits, then reads fresh state. Locks are always taken in the same order (learner row first), scoped to one learner, and held only for the duration of one apply — so throughput across *different* learners is unaffected.

Anything that mutates learner state — event ingest, cron ticks, scheduled calendar events — goes through the same applier and therefore the same lock.

---

> Full schema (column-level detail, indexes, foreign keys) coming in Milestone 1.
