# Data Model

> Living document. Update as the schema evolves.
> Last updated: 2026-07-14

The authoritative schema is `packages/db/src/schema.ts` — column-level detail,
indexes, and foreign keys live there, not here. This document covers what the
entities mean and why the schema is shaped the way it is.

---

## Core entities

These exist as tables today:

- **Integration** — a registered external system (e.g. Pika). Owns its secret hash, allowed event types, and rule pack ID.
- **Learner** — a pseudonymous student. No name, no email, no raw ID. `learners.id` is ours; `external_learner_id` is the integration's pre-hashed token, unique only within that integration.
- **Event** — a learning signal received from an integration. Immutable once written. `UNIQUE (integration_id, idempotency_key)` *is* the idempotency mechanism: ingest inserts with `ON CONFLICT DO NOTHING` and reads "no row returned" as a duplicate.
- **Economy** — XP, level, and streak per learner.
- **PetState** — mood, mood expiry, and animation per learner.
- **WorldState** — stage and unlocked objects per learner.

Economy, PetState, and WorldState each use `learner_id` as their primary key, so
one row per learner is structurally guaranteed rather than merely intended.

Planned, not yet built:

- **LearnerGroup** — a pseudonymous classroom or cohort.
- **UnlockLedger** — append-only record of every achievement, badge, and world object unlocked.
- **AuditLog** — record of every rule engine evaluation and its mutations.

## Asset registry entities

None of these are tables yet; rule packs are referenced by ID (`integrations.rule_pack_id`) and resolved in code.

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

This is why `@pal/db` connects with node-postgres over a pooled connection rather than an HTTP serverless driver. An HTTP driver sends each statement as its own request and cannot hold a transaction open, which would make the `FOR UPDATE` above silently do nothing. See the comment in `packages/db/src/client.ts` before changing the driver.

---

## Privacy

No column holds a name, email, raw student ID, grade, score, ranking, or student writing. The only free-form field is `events.metadata`, gated at the API boundary by a per-event-type allow-list. Deleting a learner cascades to their events and all three state rows, so consent withdrawal is a single `DELETE`.
