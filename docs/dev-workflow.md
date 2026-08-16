# Development Workflow

> Living document. Update this as the team evolves.
> Last updated: 2026-08-12

---

## Local setup (once per machine)

```bash
git clone https://github.com/codepetca/pal.git && cd pal
pnpm install
```

The default sandbox is an in-memory learner and needs no database or secrets:

```bash
pnpm dev
```

Open [localhost:3000/sandbox](http://localhost:3000/sandbox). Each refresh starts
a fresh learner. The sandbox uses the same public `PalProvider`, `PalAchievements`,
`PalCompanion`, `PalRewardCelebration`, and snapshot shape that Pika uses.

When changing ingest, persistence, snapshot construction, or achievement rules, enable
the optional local persisted mode:

```bash
pnpm sandbox:setup
pnpm dev
```

The setup command signs in to Vercel if needed, links the exact team-owned `pal`
project, and writes four allow-listed secrets/connections plus
`PAL_SANDBOX_MODE=persisted` to `apps/web/.env.local`. It
verifies that the database uses the sandbox-only `pal_sandbox_app` role and that
the role is denied access to production `neondb` before writing the file. The role
owns `pal_sandbox` for local integration work, but it is not a
superuser, cannot create roles or databases, and has no access to production.
Setup also proves that the Development sandbox credential receives `401` from
both production integration endpoints, so local tools cannot write production
learner state or mint production learner tokens.
The command refuses to overwrite an existing local env file; move that file aside
first if you intentionally want to switch configurations. Run
`pnpm sandbox:verify` at any time to recheck the database and role boundary.

Changes under `packages/widget/src` are built directly from the workspace, so developers can
iterate without publishing to npm. The control panel identifies both that source
and the package-version baseline. Pika continues to consume its pinned npm version
until a new widget package is deliberately released and adopted there.

If you prefer a fully isolated local database, copy `.env.example` to
`apps/web/.env.local` and use the documented Docker Postgres service instead.
**The env file goes in `apps/web/`, not the repo root** because Next.js reads env
files from the app directory.

Every Vercel PR preview serves the fixture sandbox publicly. Preview builds receive no
sandbox database, integration credential, or learner-token signing key. All persisted
sandbox APIs return 404 in previews and production. `https://pal.codepet.ca` remains
the production API and cannot enable the sandbox page or mutation routes.

### Environment reference

For manual/local-Docker configuration, set:

| Variable | What to put there | Needed when |
|---|---|---|
| `PAL_INTEGRATION_SECRET` | Pika's 32+ character backend credential; generate with `openssl rand -hex 32` | Exercising Pika ingest or read-token minting |
| `SANDBOX_INTEGRATION_SECRET` | A distinct 32+ character credential generated with `openssl rand -hex 32` | Exercising the sandbox event proxy |
| `PAL_SANDBOX_MODE` | `fixture` (default) or `persisted` | Selecting the local sandbox source; previews always force `fixture` |
| `PAL_READ_TOKEN_SIGNING_SECRET` | A third distinct 32+ character signing key generated with `openssl rand -hex 32` | Minting or verifying learner read tokens |
| `PAL_ALLOWED_WIDGET_ORIGINS` | Comma-separated exact Pika HTTPS origins; use `http://localhost:3001` for local Pika | Calling learner snapshot/reward APIs from a browser |
| `DATABASE_URL` | Ask the team lead for the dev connection string | After the M1 schema lands |

`.env.local` is gitignored — never commit it, never paste its contents into chat/issues/PRs.

The Pika-like host preview should show the 16-week Pal roadmap, companion, and
collapsible semester controls. Configure a week, complete daily logs, or finish an item on
time and confirm the roadmap, XP/pet state, and canonical achievement celebration update.
Advancing by one week automatically emits that new week's normal configuration fact,
matching Pika's planned adapter behavior.
The fictional configuration includes the same privacy-safe term range and authoritative
IANA timezone and week index that Pika will send, so a persisted learner can jump directly to any simulated
week without Pal renumbering it from the learner's first observed event.

In fixture mode, the browser keeps only a bounded synthetic action history. The
fixture endpoint replays it into a fresh in-memory reward-grant ledger, calls the
same server projector as persistence, and returns a fully redacted snapshot through
the public provider; reward acknowledgement is another replayed fixture command.
No fixture session or learner state is stored on the server. In persisted mode,
`/api/sandbox/events` attaches the sandbox integration secret server-side and
`/api/sandbox/read-token` exchanges the unguessable browser-session learner ID for a
five-minute learner-scoped token; neither secret reaches the browser. Reward dismissal
calls the real idempotent acknowledgement endpoint. Those persisted routes are local-only
and return 404 in every Vercel preview and in production.

CI runs the persisted event → Postgres → snapshot path against disposable Postgres and
compares its Weekly Rhythm roadmap with the public fixture. This preserves production
pipeline confidence without putting a shared database behind a public preview.

---

## Team domains

The project is split into four domains. Pick the one that interests you most — discuss in Discord if there's overlap. Each domain is a vertical slice with its own files, DB migrations, and tests, so you won't block each other.

| Branch prefix | Domain | Owns |
|---|---|---|
| `economy/` | **Economy & Achievements** | XP, levels, streaks, badge unlocks, `EconomyService`, `AchievementService` |
| `world/` | **World & Assets** | World templates, object unlocks, environment state, asset registry, `WorldEngine`, cron tick |
| `events/` | **Event Ingest & Rules** | Event API, idempotency, rule engine, rule pack parser, integration auth, `EventService`, `RuleEngine` |
| `frontend/` | **Frontend & Widget** | Student viewer, dev sandbox, `@codepet/pal-widget` package, teacher console read views |

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
