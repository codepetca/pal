# Pal — Claude Code context

## What this project is

A game engine as a service. External systems (like Pika) send privacy-safe learning signals. Pal maintains a persistent pet and evolving world per student.

## Monorepo structure

```
apps/web/          — Next.js app: student viewer, dev sandbox, all API routes
apps/web/public/assets/ — Static game art (see "Conventions" below)
packages/engine/   — Rule engine: pure TypeScript functions, no DB, no side effects
packages/db/       — Database schema and migrations (Drizzle)
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

## Conventions

Naming rules (files, branches, asset ref IDs) and the static asset layout live in
[dev-workflow.md](docs/dev-workflow.md#naming-conventions) — that doc is the source of truth,
don't restate it here. The short version: lowercase kebab-case for files and directories
(`cat-sleeping.png`), `PascalCase.tsx` for React components, and game art under
`apps/web/public/assets/<category>/`.

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
- [Roadmap](docs/roadmap.md)
