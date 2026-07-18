# Pal — Claude Code context

## What this project is

A game engine as a service. External systems (like Pika) send privacy-safe learning signals. Pal maintains a persistent pet and evolving world per student.

## Monorepo structure

```
apps/web/          — Next.js app: student viewer, dev sandbox, all API routes
apps/web/public/assets/ — Static game art (see "Static assets" below)
packages/engine/   — Rule engine: pure TypeScript functions, no DB, no side effects
packages/db/       — Database schema and migrations (Drizzle, coming in M1)
packages/widget/   — Embeddable widget npm package (coming in M3)
docs/              — Architecture and domain docs — read these first
```

## Key architectural constraint

**Nothing mutates learner state except the rule engine.** The engine is a pure function:
`(event + learner state + rule pack) → list of mutations`

If you are writing code that changes XP, pet mood, or world state without going through `evaluate()` in `packages/engine/src/evaluate.ts`, stop and reconsider.

## Domain ownership by branch prefix

| Branch prefix | Domain |
|---|---|
| `events/` | Event ingest API, rule engine execution, integration auth |
| `economy/` | XP, levels, streaks, applying economy mutations |
| `world/` | World stage, pet mood, object unlocks, asset registry |
| `frontend/` | Dev sandbox, student viewer, widget |

## API routes (apps/web/src/app/api/)

- `POST /api/v1/events` — ingest a learning signal from an integration
- `GET /api/v1/world/[learnerId]` — return pet + world + economy state

## How to make changes

All code changes must be made in a git worktree on a feature branch and land via PR. Never commit directly to `main`.

```bash
git worktree add -b <branch> ../pal-<short-name> main
# work in that directory, then:
gh pr create --repo codepetca/pal --base main --head <branch>
```

## Static assets

Game art lives under `apps/web/public/assets/<category>/` and is served by Next.js at
`/assets/<category>/<file>`. Categories mirror the `AssetBundle` kinds in the data model:

```
apps/web/public/assets/pets/    — pet states and animation frames
apps/web/public/assets/world/   — stage backgrounds, unlockable objects
apps/web/public/assets/badges/  — achievement art
```

- Filenames are lowercase kebab-case, no spaces: `cat-sleeping.png`, not `catsleeping.png`.
- Animation frames are numbered with a hyphen: `eating-1.png`, `eating-2.png`.
- Asset changes ship in their own PR — never bundled with game logic.

This is the M1/M2 arrangement. Once the asset registry lands (M2), these files move to object
storage and are addressed by `asset_ref_id`; keeping the categories aligned now makes that a
path swap rather than a reorganization.

## Running tests

```bash
pnpm --filter @pal/engine test   # rule engine unit tests
pnpm dev                          # start dev server at localhost:3000
```

## Privacy rules — enforce at API boundaries

Never store or accept: names, emails, raw student IDs, grades, scores, rankings, student writing.
Learner IDs must be pre-hashed by the integration before sending.

## Docs

- [Architecture overview](docs/architecture.md)
- [Rule engine](docs/rule-engine.md)
- [Data model](docs/data-model.md)
- [API contracts](docs/api.md)
- [Dev workflow](docs/dev-workflow.md)
