# CodePetPal

A gamified learning companion that connects to platforms like Pika. Students earn a living pet and an evolving world just by doing their schoolwork — submitting assignments, maintaining streaks, hitting milestones. The more they engage, the more their world grows.

## The experience

A student submits an assignment in Pika. Their pet bounces with excitement. A plant sprouts in their world. After a month of consistent work, the sun appears. After a semester, their world looks completely different from the one they started with — built entirely from their own effort.

They can see their world embedded inside Pika, or visit CodePetPal directly. Either way, it's their world, shaped by their work.

## What CodePetPal owns

1. **Pet state** — mood, animation, energy (reacts to events in real time)
2. **World state** — an environment that grows through time, effort, and milestones
3. **The rules** — what learning signals cause what changes

## What it does NOT own

- Student identity or authentication (that's Pika's)
- Grades, scores, or raw learning data
- Classroom management

Privacy is a first-class constraint. CodePetPal receives only pseudonymous IDs and low-risk signals — never names, grades, or student content.

## How it connects to Pika (and other platforms)

Pika sends CodePetPal privacy-safe learning signals:
- Assignment completed
- Daily check-in
- Streak milestone
- Calendar event (end of month, end of semester)

CodePetPal processes those signals through a rule engine and updates the student's pet and world. Pika then renders the result — either as an embedded widget or by linking to the standalone student viewer.

Any learning platform can integrate this way. Pika is the first.

## The dev sandbox

Developers working on CodePetPal use a built-in sandbox UI to fire test events and immediately see the pet react and world change — no Pika connection needed. It's the primary tool for building and testing game logic locally.

## Team

Design discussions, proposals, and feedback happen in **Discord**. Bring an idea to Discord first — once it's agreed on, update the relevant doc in this repo. The docs here are the source of truth for decisions already made, not a place to debate them.

## Quick links

- [Architecture overview](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API contracts](docs/api.md)
- [Rule engine](docs/rule-engine.md)
- [Integration guide](docs/integration.md)
- [Development workflow](docs/dev-workflow.md)

## Repo structure

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

1. **Read [`docs/architecture.md`](docs/architecture.md)** — understand the system before writing any code
2. **Find your domain** in [`docs/dev-workflow.md`](docs/dev-workflow.md) — each developer owns a vertical slice
3. **Read your domain's doc** — linked from the workflow doc
4. **Pick up Milestone 1 (M1) tasks** for your domain — the first goal is a working dev sandbox with event ingest and a visible pet reaction

> Full setup instructions (install, env vars, local dev commands) will be added once the repo is scaffolded.
