# Pal

A gamified learning companion that connects to platforms like Pika. Students earn a living pet and an evolving world just by doing their schoolwork — submitting assignments, maintaining streaks, hitting milestones. The more they engage, the more their world grows.

## The experience

A student submits an assignment in Pika. Their pet bounces with excitement. A plant sprouts in their world. After a month of consistent work, the sun appears. After a semester, their world looks completely different from the one they started with — built entirely from their own effort.

They can see their world embedded inside Pika, or visit Pal directly. Either way, it's their world, shaped by their work.

## What Pal owns

1. **Pet state** — mood, animation, energy (reacts to events in real time)
2. **World state** — an environment that grows through time, effort, and milestones
3. **The rules** — what learning signals cause what changes

## What it does NOT own

- Student identity or authentication (that's Pika's)
- Grades, scores, or raw learning data
- Classroom management

Privacy is a first-class constraint. Pal receives only pseudonymous IDs and low-risk signals — never names, grades, or student content.

## How it connects to Pika (and other platforms)

Pika sends Pal privacy-safe learning signals:
- Assignment completed (including Pika's on-time classification)
- Daily check-in
- Resource viewed
- Calendar event (end of month, end of semester)

Pal derives streaks, achievements, and rewards from those signals, then updates the student's pet and world. Pika renders the result — either as an embedded widget or by linking to the standalone student viewer.

Any learning platform can integrate this way. Pika is the first.

## The dev sandbox

Developers working on Pal use a built-in sandbox UI to fire test events and immediately see the pet react and world change — no Pika connection needed. It's the primary tool for building and testing game logic locally.

## Team

Design discussions, proposals, and feedback happen in **Discord**. Bring an idea to Discord first — once it's agreed on, update the relevant doc in this repo. The docs here are the source of truth for decisions already made, not a place to debate them.

## Quick links

- [Architecture overview](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API contracts](docs/api.md)
- [Rule engine](docs/rule-engine.md)
- [Integration guide](docs/integration.md)
- [Pika signal adapter and achievement pipeline](docs/pika-signal-adapter.md)
- [Development workflow](docs/dev-workflow.md)
- [Roadmap](docs/roadmap.md)

## Repo structure

```
apps/
  web/          # Student viewer, dev sandbox, and all API routes (Next.js)
    public/assets/   # Static game art — pets/, world/, badges/
packages/
  engine/       # Rule engine (pure functions, no DB)
  db/           # Drizzle schema + migrations
docs/           # Living architecture documents (start here)
```

Planned, not yet in the repo:

```
apps/admin/       # Operator + teacher console (M2)
packages/widget/  # @pal/widget npm package (M3)
```

Next.js serves both the UI and the API — there is no separate API server. See
[Tech stack](docs/architecture.md#tech-stack).

## Getting started

1. **Read [`docs/architecture.md`](docs/architecture.md)** — understand the system before writing any code
2. **Find your domain** in [`docs/dev-workflow.md`](docs/dev-workflow.md) — each developer owns a vertical slice
3. **Read your domain's doc** — linked from the workflow doc
4. **Pick up Milestone 1 (M1) tasks** for your domain — the first goal is a working dev sandbox with event ingest and a visible pet reaction

This project uses **pnpm**. Do not use `npm install` — it will create conflicts.

```bash
npm install -g pnpm   # install pnpm if you don't have it
pnpm install          # install all dependencies
pnpm dev              # start the dev server
```

Then open [http://localhost:3000/sandbox](http://localhost:3000/sandbox) to see the dev sandbox.
