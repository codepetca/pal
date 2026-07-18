# Development Workflow

> Living document. Update this as the team evolves.
> Last updated: 2026-07-06

---

## Local setup (once per machine)

```bash
git clone https://github.com/codepetca/pal.git && cd pal
pnpm install
```

Then create your local env file. **It goes in `apps/web/`, not the repo root** — Next.js only reads env files from the app directory:

```bash
cp .env.example apps/web/.env.local
```

Open `apps/web/.env.local` and set:

| Variable | What to put there | Needed when |
|---|---|---|
| `SANDBOX_INTEGRATION_SECRET` | Any long random string — generate one with `openssl rand -hex 24`. It's yours alone; it does not need to match anyone else's. | Now — the sandbox can't fire events without it |
| `DATABASE_URL` | Ask the team lead for the dev connection string | After the M1 schema lands |

`.env.local` is gitignored — never commit it, never paste its contents into chat/issues/PRs.

**Check it works:**

```bash
pnpm dev
```

Open [localhost:3000/sandbox](http://localhost:3000/sandbox), click **Assignment completed**, and you should see `→ assignment.completed: processed` in the event log. If you get a 500 with `sandbox_not_configured`, the env file is missing or in the wrong folder.

Why the secret exists: the ingest API (`POST /api/v1/events`) rejects unauthenticated requests, exactly as it will for real integrations. Your browser never sees the secret — the sandbox posts through a server-side proxy (`/api/sandbox/events`) that attaches it, playing the role of an integration's backend.

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

## Key conventions

These four are invariants — breaking one breaks production or leaks data:

- Never mutate learner state outside the rule engine
- All DB mutations are transactional
- Migrations are append-only (no destructive changes without a plan)
- No raw student PII ever enters the DB — enforce at the API boundary

## Naming conventions

- **Files and directories** — lowercase kebab-case, no spaces: `rule-pack.ts`, `cat-sleeping.png`.
  Two exceptions: React components are `PascalCase.tsx`, matching the component they export,
  and conventional root files keep their usual uppercase (`README.md`, `CLAUDE.md`, `LICENSE`).
- **Branches** — `<domain-prefix>/<short-description>`, kebab-case: `world/asset-registry`.
  Prefixes are listed under [Team domains](#team-domains); use `infra/` for repo-wide changes.
- **Asset ref IDs** — kebab-case with a version suffix: `world-bird-v1`, matching the example in
  [rule-engine.md](rule-engine.md#effect-types).

> **Proposed, not yet agreed:** treat asset ref IDs as immutable — never rename one in place,
> publish a new version instead. Rule packs reference these IDs, so a rename silently breaks
> live worlds. Needs a Discord decision before it becomes a rule.

## Static assets

Game art lives under `apps/web/public/assets/<category>/` and is served by Next.js at
`/assets/<category>/<file>`. Categories mirror the `AssetBundle` kinds in the
[data model](data-model.md#asset-registry-entities):

```
apps/web/public/assets/pets/    — pet states and animation frames
apps/web/public/assets/world/   — stage backgrounds, unlockable objects
apps/web/public/assets/badges/  — achievement art
```

- Animation frames are numbered with a hyphen: `eating-1.png`, `eating-2.png`.
- Source art is often much larger than display size. Serve through `next/image` so it is
  resized on demand, and downscale before shipping anything to the widget.
- Asset changes ship in their own PR — never bundled with game logic.

### Where assets live, and when that changes

In the repo through M2 — free, no infrastructure, and art deploys atomically with the code that
uses it. Two things trigger the move to object storage (see [roadmap](roadmap.md)), neither of
them file size:

- An operator uploads art without opening a PR (M4 console, seasonal packs)
- Widget embed bandwidth becomes a billed line item (M3)

That move is a config change **only if** every consumer resolves `asset_ref_id` → URL. Build the
resolver with the M2 registry and never hardcode a path — especially not in the widget, where
integrators pin a version you cannot retroactively change.

Still open: Vercel Blob vs Cloudflare R2 (R2's zero egress matters only once widget traffic is
real). Whichever wins, remote assets need `images.remotePatterns` in `next.config.ts`, and
versioned ref IDs avoid CDN staleness since a new version is a new path.
