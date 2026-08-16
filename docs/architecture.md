# Architecture Overview

> Living document. Last updated: 2026-08-16

## The one-sentence version

Pal is a game engine and reward projector: integrations send privacy-safe learning
facts, Pal applies deterministic rules to persistent learner state, and authenticated
clients receive a presentation-safe snapshot.

## End-to-end flow

1. Pika's backend sends a versioned, allow-listed event to `POST /api/v1/events`.
2. The contract package rejects unknown fields and invalid metadata before persistence.
3. Pal authenticates the integration and serializes the learner transaction with a
   PostgreSQL row lock.
4. The pure engine evaluates the event and derived events. The transaction applies
   its mutations, records achievement transitions, and writes exact-once reward facts.
5. Weekly Rhythm may grant the chapter assigned to that learner's immutable term plan.
   Level, streak, and on-time transitions may grant stable behavior titles.
6. Pika mints a short-lived learner-scoped read token and the widget requests the
   learner snapshot.
7. The server resolves durable grants against pinned catalogs and removes all unearned
   story content before serialization. The widget validates and renders the DTO; it
   does not decide eligibility.

## Repository layers

| Layer | Location | Responsibility |
|---|---|---|
| Integration contract | `packages/contract` | Versioned event envelopes, metadata allow-lists, privacy validation |
| Rule engine | `packages/engine` | Pure event + state + rules → mutations evaluation |
| Persistence | `packages/db` | PostgreSQL schema, constraints, indexes, and migrations |
| Application | `apps/web` | Authentication, transactions, achievements, story authority, snapshot projection, APIs, sandbox |
| Widget | `packages/widget` | Public DTO types, snapshot validation, HTTP client, and React rendering |

Next.js App Router hosts both the application UI and API on Vercel. PostgreSQL is the
durable store; local persisted development and CI use isolated databases. Static art
is versioned under `apps/web/public/assets`. There is no Redis cache, background
scheduler, classroom model, story CMS, or object-storage asset registry in the MVP.

## State authority

The engine is a pure function:

```text
(event + learner state + rule pack) → mutations
```

`processEventInDb` owns the write transaction. It locks the learner, inserts the
idempotent transport event and semantic fact, evaluates the engine cascade, applies
mutations, and records eligible achievements and grants. No route or widget directly
changes XP, pet mood, streak, level, or world state.

Persistence-authorized internal events are emitted only after their durable transition
wins. For example, daily-log XP follows an exact-once settlement marker and story
progress follows the first earned Weekly Rhythm transition for a plan slot. Synthetic
events are never accepted at the public ingest boundary.

## Adaptive story and rewards

Story catalogs, release schedules, deterministic planning, and the canonical projector
are server-only application modules.

- Story release eligibility is based on authoritative `term_start_day`.
- A complete 6–24-week plan is persisted per learner and never rewritten.
- Deterministic planning makes learners with the same release, start day, and term
  length receive the same chapter sequence without a classroom table.
- `learner_reward_grants` is append-only durable ownership for `story_chapter` and
  `behavior_title` grants.
- Story grants reference the exact learner-owned plan assignment. Catalog content is
  resolved at read time from the plan's pinned story version.
- Database-generated grant order, not timestamps, determines action and title order.
- Acknowledgement sets `seen_at`; it never deletes ownership.
- Transient notices remain separate from durable collection/title ownership.

The browser package contains no story catalog, future chapter copy, title definitions,
or future asset URLs. Locked DTO slots contain only concealed presentation state.

## Read authentication

An integration backend exchanges its credential and a pseudonymous learner token for a
five-minute learner-scoped JWT. Browser snapshot and acknowledgement routes validate
issuer, audience, integration, learner, scope, and the exact allowed origin. Integration
credentials never enter the browser. Responses use `Cache-Control: no-store`.

The optional persisted sandbox uses a separate integration secret and isolated database
role. Public PR previews use the bounded stateless fixture projector. Persisted sandbox
routes are local-only and return 404 in previews and production.

## Concurrency and exact-once behavior

Transport idempotency and semantic deduplication solve retries; the learner row lock
solves different concurrent events racing from the same starting state. Structural
database constraints independently enforce learner ownership and reward uniqueness.

```text
BEGIN
  SELECT learner FOR UPDATE
  insert transport event (unique integration + idempotency key)
  insert semantic fact (unique learner + fact identity)
  evaluate and apply mutations
  insert achievement/grant transitions with exact-once constraints
COMMIT
```

Reads use a repeatable-read transaction so one snapshot cannot combine state from
different commits.

## Privacy boundary

Pal never accepts names, emails, raw student IDs, grades, scores, rankings, student
writing, messages, or browsing history. Integrations pseudonymize learner identifiers
before sending them. The contract rejects unknown envelope and metadata fields; it does
not silently strip them. Fixture request objects are also exact-key validated.

## Implemented APIs

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/v1/events` | Authenticated learning-fact ingest |
| `POST` | `/api/v1/integration/read-token` | Mint a learner-scoped read token |
| `GET` | `/api/v1/learner/snapshot` | Return projected roadmap, companion, collection, and rewards |
| `POST` | `/api/v1/learner/rewards/:rewardId/seen` | Idempotently acknowledge a reveal/notice |

Sandbox-only routes are documented in [dev-workflow.md](dev-workflow.md). Proposed
admin, scheduling, deletion, and rule-preview APIs are not implemented contracts.

## Deferred product work

- previous-week catch-up and late-join recovery;
- midterm term-length changes;
- classroom-wide shared story progress or classroom modeling;
- operator-defined schedules and a story CMS;
- teacher/admin consoles and aggregate views;
- object-storage asset delivery.

See [api.md](api.md), [data-model.md](data-model.md), [rule-engine.md](rule-engine.md),
and [pika-signal-adapter.md](pika-signal-adapter.md) for detailed contracts.
