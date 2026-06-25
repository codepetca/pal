# Development Workflow

> Living document. Update this as the team evolves.
> Last updated: 2026-06-25

---

## Team domains

Each developer owns a vertical slice — their own service files, DB migrations, and tests. Minimize cross-domain coupling.

| Developer | Domain | Owns |
|---|---|---|
| Dev A | **Economy & Achievements** | XP, levels, streaks, badge unlocks, `EconomyService`, `AchievementService` |
| Dev B | **World & Assets** | World templates, object unlocks, environment state, asset registry, `WorldEngine`, cron tick |
| Dev C | **Event Ingest & Rules** | Event API, idempotency, rule engine, rule pack parser, integration auth, `EventService`, `RuleEngine` |
| Dev D | **Frontend & Widget** | Student viewer, dev sandbox, `@codepetpal/widget` package, teacher console read views |

---

## PR rules

- Migrations ship in their own PR, never bundled with logic changes
- Rule pack schema changes are their own PR (they touch every domain)
- Asset registry changes never touch game logic PRs
- No PR merges without at least one review from another team member

---

## Test strategy

| Layer | Approach |
|---|---|
| Rule engine | Pure function → table-driven unit tests. High coverage required. |
| World engine | Property-based: "after N days, stage should be ≥ M" |
| Event ingest API | Integration tests against real DB. Always test idempotency key collision. |
| Widget | Playwright component tests with a mock read API |

---

## Staged roadmap

### Milestone 1 — Pika-first foundation
- Event ingest API + idempotency
- Basic rule pack (assignment.completed → XP + pet mood)
- Economy table (XP, level, streak)
- World state stub (stage field only)
- Minimal student viewer (pet + XP bar)

### Milestone 2 — World depth
- World object unlocks + asset registry
- Time-elapsed WORLD_TICK cron
- World visual layers in viewer and widget
- Rule preview endpoint for operators

### Milestone 3 — Multi-integration
- Integration setup portal
- `@codepetpal/widget` npm package
- Read token mint flow
- Teacher console (aggregate views, no PII)

### Milestone 4 — Scheduling + ops
- Operator-defined semester/calendar schedules
- Operator console: rule pack editor, asset uploads, failed event replay
- Nudge/copy packs
- Seasonal theme packs

---

## Key conventions

- Never mutate learner state outside the rule engine
- All DB mutations are transactional
- Migrations are append-only (no destructive changes without a plan)
- No raw student PII ever enters the DB — enforce at the API boundary
