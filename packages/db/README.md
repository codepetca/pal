# @pal/db

Database schema and migrations.

This package owns all table definitions and migration files. No business logic
lives here — just schema. The mutation applier, the rule engine, and the API
routes live elsewhere and import from here.

## Tables

| Table | Holds | One per |
|---|---|---|
| `integrations` | registered external system, its secret hash, event allow-list, rule pack | integration |
| `learners` | internal ID ↔ the integration's pseudonymous learner ID | learner |
| `events` | immutable record of every received signal | event |
| `learner_facts` | append-only, semantically unique normalized behavior derived from events | learner + fact type + semantic identity |
| `achievement_periods` | stable roadmap order for opaque academic periods | learner + period |
| `story_plans` | immutable term start, versioned story identity, and length for an opaque academic term | learner + term |
| `story_plan_chapters` | ordered chapter assignment, optionally bound to an opaque period | story plan + period number |
| `learner_reward_grants` | append-only durable story chapter and behavior title ownership | learner + earned reward |
| `weekly_rhythm_configs` | latest accepted weekly opportunity configuration | learner + period |
| `achievement_instances` | progress or an outcome for a scoped achievement | learner + achievement + scope |
| `reward_notices` | one-time presentation notice attached to an award | awarded achievement |
| `economy` | XP, level, streak | learner |
| `pet_state` | mood, mood expiry, animation | learner |
| `world_state` | stage, unlocked objects | learner |

The three state tables use `learner_id` as their **primary key**, so one row per
learner is structurally guaranteed rather than merely intended.

Two constraints carry more weight than the rest:

- `UNIQUE (integration_id, external_learner_id)` on `learners` — an integration's
  learner ID means nothing outside that integration.
- `UNIQUE (integration_id, idempotency_key)` on `events` — this *is* the
  idempotency mechanism. Ingest inserts with `ON CONFLICT DO NOTHING` and treats
  "no row returned" as a duplicate, rather than doing a read-then-write check
  that two concurrent retries could both pass.
- `UNIQUE (learner_id, event_type, semantic_key)` on `learner_facts` — a
  producer cannot count the same activity date, classroom, item, or weekly
  configuration revision twice by changing its transport idempotency key.
- `UNIQUE (learner_id, achievement_key, scope_key)` on
  `achievement_instances` — lifetime, per-classroom, per-item, and recurring
  weekly awards share the same exactly-once rule.
- `UNIQUE (learner_id, term_key)` on `story_plans` — concurrent creation cannot
  give one learner two story plans for the same term. The first story release
  pins the authoritative term start, story version, and supported length; a
  trigger rejects later identity or calendar-length changes.
- `UNIQUE (story_plan_id, period_number)`, `UNIQUE (story_plan_id, period_key)`,
  and `UNIQUE (story_plan_id, chapter_id)` on `story_plan_chapters` — one plan
  cannot schedule two rewards in one position, bind one period twice, or repeat
  a collectible chapter. Composite foreign keys ensure every non-null period
  belongs to the plan's learner, and a deferred commit-time constraint requires
  exactly the contiguous ordinals `1..total_periods`.
- Partial unique indexes on `learner_reward_grants` enforce one story grant per
  plan slot and source fact plus one lifetime grant per learner/behavior title.
  Composite foreign keys bind every grant to the same learner's source fact and,
  for story grants, the exact plan assignment. A generated bigint orders grants
  durably; only `seen_at` may change after insert.
- `UNIQUE (achievement_instance_id)` on `reward_notices` — retrying an award
  cannot queue a second celebration.

## Privacy

No column holds a name, email, raw student ID, grade, score, ranking, or student
writing. Free-form event/fact metadata is gated at the API boundary by a strict
per-event-type allow-list. Period, item, and classroom keys are opaque
integration-scoped tokens. Deleting a learner cascades to facts, achievements,
rewards, events, and state, so consent withdrawal remains a single `DELETE`.

## Local setup

```bash
cp .env.example apps/web/.env.local    # if you haven't already
docker compose up -d postgres          # from the repo root; Postgres on :5433
pnpm --filter @pal/db migrate          # apply migrations
```

Commands here read `DATABASE_URL` from `apps/web/.env.local` (that's where
Next.js wants it — see `docs/dev-workflow.md`), so you don't need to export
anything. A real environment variable, as in CI, takes precedence over the file.

`DATABASE_URL` must be a **pooled** connection string. Event ingest holds an
interactive transaction (`SELECT ... FOR UPDATE` on the learner row, then read,
then write), which HTTP-based serverless drivers cannot do — read the comment in
`src/client.ts` before changing the driver.

## Changing the schema

```bash
# edit src/schema.ts first
pnpm --filter @pal/db generate --name <description>
pnpm --filter @pal/db migrate
pnpm --filter @pal/db check            # migration history is self-consistent
```

`generate` is the step people forget. Editing `schema.ts` without it leaves the
TypeScript and the SQL describing different databases, and nothing at runtime
complains — the migrations still apply, they just don't contain your column. CI
catches this by re-running `generate` and failing if it produces a diff, so a
forgotten `generate` shows up as a red build rather than a missing column in
production.

`check` is a different guarantee: it validates the `drizzle/` folder against
itself (stale snapshot format, two migrations claiming the same parent after a
bad merge). It never reads `schema.ts`, so it cannot detect drift.

## Conventions

- One migration file per PR
- Migrations ship in their own PR, never bundled with logic changes
- Migrations are append-only — never edit an existing migration
- Migration filenames are generated by drizzle-kit and start at zero:
  `0000_initial_schema.sql`, `0001_add_unlock_ledger.sql`. Commit the whole
  `drizzle/` folder, `meta/` included — both CI checks read it.
