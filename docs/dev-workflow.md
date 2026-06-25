# Development Workflow

> Living document. Update this as the team evolves.
> Last updated: 2026-06-25

---

## Team domains

Each developer owns a vertical slice — their own service files, DB migrations, and tests. Minimize cross-domain coupling.

| Branch prefix | Domain | Owns |
|---|---|---|
| `economy/` | **Economy & Achievements** | XP, levels, streaks, badge unlocks, `EconomyService`, `AchievementService` |
| `world/` | **World & Assets** | World templates, object unlocks, environment state, asset registry, `WorldEngine`, cron tick |
| `events/` | **Event Ingest & Rules** | Event API, idempotency, rule engine, rule pack parser, integration auth, `EventService`, `RuleEngine` |
| `frontend/` | **Frontend & Widget** | Student viewer, dev sandbox, `@codepetpal/widget` package, teacher console read views |

---

## PR workflow

Every change goes through a PR — no direct pushes to `main`.

1. **Branch** off `main` using your domain prefix: `economy/xp-service`, `world/asset-registry`
2. **Write code**, commit often with clear messages
3. **Open a PR** on GitHub when ready for review
4. **Run AI review** in Claude Code: `/code-review --comment`
   - This posts inline findings directly on the PR
   - Fix anything flagged before requesting a human review
5. **Tag a teammate** to approve (any other team member)
6. **Merge** once approved — squash merge preferred to keep history clean

### PR rules

- Migrations ship in their own PR, never bundled with logic changes
- Rule pack schema changes are their own PR (they touch every domain)
- Asset registry changes never touch game logic PRs
- AI review (`/code-review --comment`) must be run before requesting human approval

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
