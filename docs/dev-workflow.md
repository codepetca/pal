# Development Workflow

> Living document. Update this as the team evolves.
> Last updated: 2026-06-25

---

## Team domains

The project is split into four domains. Pick the one that interests you most — discuss in Discord if there's overlap. Each domain is a vertical slice with its own files, DB migrations, and tests, so you won't block each other.

| Branch prefix | Domain | Owns |
|---|---|---|
| `economy/` | **Economy & Achievements** | XP, levels, streaks, badge unlocks, `EconomyService`, `AchievementService` |
| `world/` | **World & Assets** | World templates, object unlocks, environment state, asset registry, `WorldEngine`, cron tick |
| `events/` | **Event Ingest & Rules** | Event API, idempotency, rule engine, rule pack parser, integration auth, `EventService`, `RuleEngine` |
| `frontend/` | **Frontend & Widget** | Student viewer, dev sandbox, `@pal/widget` package, teacher console read views |

> Domains are a starting point. If two people want to pair on something, or the split needs adjusting after M1, bring it up in Discord.

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

TDD is **recommended for the rule engine**, optional everywhere else.

The rule engine is a pure function — no database, no server, no setup. It's the easiest place to learn TDD and the most important place to have tests. Write the test first, then make it pass.

For other domains, test what makes sense to you. Don't skip testing entirely, but don't force TDD if it slows you down.

| Layer | Approach | TDD? |
|---|---|---|
| Rule engine | Unit tests — see `packages/engine/src/evaluate.test.ts` for examples | Recommended |
| Economy service | Unit tests for XP/level/streak logic | Optional |
| World service | Test mood expiry, stage transitions | Optional |
| Event ingest API | Integration tests — test idempotency key collision | Optional |
| Frontend | Manual testing via the dev sandbox is fine for M1 | N/A |

Run engine tests:
```bash
pnpm --filter @pal/engine test
```

---

## Staged roadmap

### Milestone 1 (M1) — Pika-first foundation
- Event ingest API + idempotency
- Basic rule pack (assignment.completed → XP + pet mood)
- Economy table (XP, level, streak)
- World state stub (stage field only)
- Minimal student viewer (pet + XP bar)

### Milestone 2 (M2) — World depth
- World object unlocks + asset registry
- Time-elapsed WORLD_TICK cron
- World visual layers in viewer and widget
- Rule preview endpoint for operators

### Milestone 3 (M3) — Multi-integration
- Integration setup portal
- `@pal/widget` npm package
- Read token mint flow
- Teacher console (aggregate views, no PII)

### Milestone 4 (M4) — Scheduling + ops
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
