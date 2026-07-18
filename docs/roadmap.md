# Roadmap

What we're building and in what order. For *how* to contribute — setup, branching, PRs,
conventions — see [dev-workflow.md](dev-workflow.md).

Milestones are sequential but not dated. A milestone is done when everything under it ships.

## Milestone 1 (M1) — Pika-first foundation
- Event ingest API + idempotency
- Basic rule pack (assignment.completed → XP + pet mood)
- Economy table (XP, level, streak)
- World state stub (stage field only)
- Minimal student viewer (pet + XP bar)

## Milestone 2 (M2) — World depth
- World object unlocks + asset registry
- Asset resolver: `asset_ref_id` → URL, so nothing hardcodes an asset path
- Time-elapsed WORLD_TICK cron
- World visual layers in viewer and widget
- Rule preview endpoint for operators

## Milestone 3 (M3) — Multi-integration
- Integration setup portal
- `@pal/widget` npm package
- Read token mint flow
- Teacher console (aggregate views, no PII)

## Milestone 4 (M4) — Scheduling + ops
- Operator-defined semester/calendar schedules
- Operator console: rule pack editor, asset uploads, failed event replay
- Nudge/copy packs
- Seasonal theme packs
