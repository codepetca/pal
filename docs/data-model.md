# Data Model

> Living document. Update as the schema evolves.
> Last updated: 2026-08-17

The authoritative schema is `packages/db/src/schema.ts` — column-level detail,
indexes, and foreign keys live there, not here. This document covers what the
entities mean and why the schema is shaped the way it is.

---

## Core entities

These exist as tables today:

- **Integration** — a registered external system (e.g. Pika). Owns its secret hash, allowed event types, and rule pack ID.
- **Learner** — a pseudonymous student. No name, no email, no raw ID. `learners.id` is ours; `external_learner_id` is the integration's pre-hashed token, unique only within that integration.
- **Event** — a learning signal received from an integration. Immutable once written. `UNIQUE (integration_id, idempotency_key)` *is* the idempotency mechanism: ingest inserts with `ON CONFLICT DO NOTHING` and reads "no row returned" as a duplicate.
- **Economy** — XP, level, and streak per learner. The engine tracks two XP numbers, and the distinction matters:
  - `xp` — the **balance** toward the next level. A level-up spends it (a negative `XP_GRANT`), so it goes down as well as up. This is what a progress bar renders.
  - `xp_lifetime` — every point ever earned, never spent. This is what lifetime achievements key on. Without it, levelling would erase the only record that the XP existed.

  School-day rhythm continuity is anchored on `streak_last_day` (the validated
  source `activity_day`), not on `occurred_at` or `last_event_at` — otherwise a
  timezone offset or unrelated assignment could stand in for a daily log.

- **PetState** — mood, mood expiry, and animation per learner.
- **WorldState** — stage and unlocked objects per learner.
- **LearnerFact** — a privacy-safe, semantically unique fact derived from an accepted event. It prevents the same learner behavior from counting twice even if a producer changes the transport idempotency key.
- **AchievementPeriod** — roadmap placement for an opaque academic period. Its anchor is the earliest authoritative behavior/configuration time seen for that period, so delivery order cannot reorder weeks.
- **StoryPlan** — one immutable authoritative term start, versioned story identity, and supported period count for a learner's opaque academic term. Its normalized chapter assignments must cover every contiguous ordinal at transaction commit and may bind only to an opaque period owned by that learner. Plan identity, term length, and chapter assignments never change after creation; only an initially unbound period key may be attached once. Chapter IDs are catalog references, never student-authored content.
- **StoryCollectibleSchedule** — a typed, durable due-work row derived from the first valid weekly configuration fact inserted after the scheduling migration for one learner and opaque period. Its indexed `due_at` materializes the authoritative local calendar boundary so workers never scan or cast historical JSON. `reconciled_at` consumes queue work only after the existing reward ledger proves ownership; it is not a second ownership source. Identity and due fields are immutable, no historical calendar facts are backfilled, and deletion follows the source fact's learner-owned cascade.
- **LearnerRewardGrant** — the append-only durable ownership ledger. A `story_chapter` grant references the exact learner-owned plan assignment; a `behavior_title` grant references a stable title ID. A chapter is granted once after its authoritative local instructional week ends, regardless of Weekly Rhythm. The grant stores no sketch/color finish: the snapshot projects that from the durable weekly achievement, allowing a delayed achievement to upgrade presentation without a second item. Every grant references the same learner's source fact, carries database-generated order, and remains owned after `seen_at` is set. Partial uniqueness makes event/cron retries exact-once without deriving ownership from notices or current economy state.
- **WeeklyRhythmConfig** — the highest accepted Pika opportunity configuration for one learner and period, including whether delayed facts require reconciliation.
- **AchievementInstance** — one durable achievement outcome within its lifetime, classroom, item, or weekly scope. Earned outcomes are historical and are not revoked by later source-system edits.
- **RewardNotice** — an exactly-once learner-facing reward notification linked to its achievement instance. A nullable acknowledgement timestamp makes reads retryable and acknowledgement idempotent.

Economy, PetState, and WorldState each use `learner_id` as their primary key, so
one row per learner is structurally guaranteed rather than merely intended.

Planned, not yet built:

- **LearnerGroup** — a pseudonymous classroom or cohort.
- **UnlockLedger** — a future generalized append-only record for world objects and
  consumables. Current Weekly Rhythm keepsakes persist idempotently in
  `world_state.unlocked_object_ids`; achievement celebrations remain transient
  notices and never become durable inventory.
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

Anything that writes learner state — event ingest, cron ticks, scheduled
calendar events, or reward-ledger reconciliation — takes this same learner lock.
Gameplay mutations still flow through the engine/applier. The story scheduler
does not manufacture a gameplay event; it inserts only the already-selected
chapter's ownership row under this lock and relies on the ledger's uniqueness
constraint for retry safety.

This is why `@pal/db` connects with node-postgres over a pooled connection rather than an HTTP serverless driver. An HTTP driver sends each statement as its own request and cannot hold a transaction open, which would make the `FOR UPDATE` above silently do nothing. See the comment in `packages/db/src/client.ts` before changing the driver.

---

## Privacy

No column holds a name, email, raw student ID, grade, score, ranking, or student writing. The only free-form field is `events.metadata`, gated at the API boundary by a per-event-type allow-list. Deleting a learner cascades to their events and all three state rows, so consent withdrawal is a single `DELETE`.
