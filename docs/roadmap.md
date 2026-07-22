# Roadmap

What we're building and in what order. For *how* to contribute — setup, branching, PRs,
conventions — see [dev-workflow.md](dev-workflow.md).

Milestones are sequential but not dated. A milestone is done when everything under it ships.

## Achievement-system workstream (sequencing TBD)

The project's target direction is a recurring achievement roadmap driven automatically by integrations. The cross-project ownership boundary, signal flow, duplicate semantics, Weekly Rhythm example, and detailed Pika/Pal build checklists live in [Pika Signal Adapter and Achievement Pipeline](pika-signal-adapter.md).

At a high level:

- **Pika:** normalize authoritative activity into privacy-safe events and deliver them through a reliable adapter/outbox.
- **Pal:** aggregate events into distinct facts, track scoped/recurring achievement progress, award badges and rewards, and render a vertical weekly roadmap through `/embed/roadmap`.
- **Teachers:** no additional Pal configuration or achievement maintenance.

The initial workstream rewards completed behaviors and configured weekly opportunities. It does not mirror Pika's assignment catalog or infer that a silent assignment is incomplete. A complete assignment-status view is deferred unless the product later adopts a separate, versioned Pika-owned academic projection with reconciliation.

The initial Pika presentation places the roadmap in Pika's content pane. Only the compact pet companion and brief reward celebrations may render as overlays.

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
