# CodePetPal

A game engine as a service. Send it privacy-safe learning signals — it maintains a persistent pet and evolving world per student.

## What this is

CodePetPal owns three things:
1. **Game state** — pet mood, XP, level, streaks
2. **World state** — an environment that grows and changes over time and milestones
3. **The rules** — what events cause what changes

It does NOT own: student identity, authentication, raw learning data, grades, or classroom management. Those belong to the integrating system (e.g. Pika).

## What it is NOT

- Not a student information system
- Not an auth provider
- Not a gradebook or analytics platform
- Not a content delivery system

## Quick links

- [Architecture overview](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API contracts](docs/api.md)
- [Rule engine](docs/rule-engine.md)
- [Integration guide](docs/integration.md)
- [Development workflow](docs/dev-workflow.md)

## Repo structure (planned)

```
apps/
  web/          # Student world viewer + dev sandbox (Next.js)
  admin/        # Operator + teacher console (Next.js)
packages/
  api/          # Hono API server
  engine/       # Rule engine (pure functions, no DB)
  widget/       # @codepetpal/widget npm package
  db/           # Drizzle schema + migrations
docs/           # Living architecture documents (start here)
```

## Getting started

> Setup instructions will live here once the repo is bootstrapped.
