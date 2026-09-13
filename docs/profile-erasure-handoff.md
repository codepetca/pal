# Pal profile erasure schema handoff

This is a schema-only prerequisite for the Pal portion of Phase 3 in the single
[Pika roadmap](https://github.com/codepetca/pika/blob/main/docs/guidance/classroom-pal-and-student-cleanup-plan.md).
The [provider contract and inventory](profile-erasure-contract.md) define the
next API increment. Accepting this slice does not complete production erasure,
Pika cleanup, copy handling, or Phase 3.

- Worktree: `/Users/stew/.codex/worktrees/3db2/pal`.
- Branch: `events/profile-erasure-schema`, based on refreshed main
  `69c3c91b07245f27bc7c82f67990ae839cc8d922`.
- Migration: `packages/db/drizzle/0013_profile_erasure_operations.sql` plus
  generated Drizzle snapshot/journal. One dormant table; no current learner or
  gameplay/API changes, backfill, flags, dependencies, or deployment.
- Initial implementation SHA: `816d277013389342e8dc8dd7408a3fa2e21033f0`.
  Scope-test correction SHA: `1a9940bb0e604f79f9cf9f66217bd002a2e8454c`.
  These are evidence checkpoints, not a substitute for verifying the actual
  PR head at publication/CI/merge time. Subsequent commits may update this ledger.
  [PR #103](https://github.com/codepetca/pal/pull/103) was published as a draft
  at `ff97d7ccb02148eb595d01a980614f17965ba2be` after exact CI approval.
- Source verification: full workspace typecheck and lint passed; migration history
  check passed; regeneration reports no schema drift; `git diff --check` passed.
  Initially, DB suite: 2 source tests passed and 8 PostgreSQL tests skipped
  without `DATABASE_URL`. Approved CI now passes all 10 DB tests with zero skips.
  Existing event-contract tests (12) and rule-engine tests (68) also pass.
- Prescribed Claude `/code-review --comment` is not available in this task's
  callable tools. Independent Sol/high security/concurrency and Terra/high
  compatibility reviews are the available alternative, not a Claude pass.
- Schema application approval: user explicitly approved the existing CI's fresh
  disposable PostgreSQL 16 service, migrations `0000`–`0013` and synthetic
  invariant/upgrade tests; relayed by the coordinator on 2026-09-12.
  No existing local, shared sandbox, hosted, or production target is approved.
- Merge: requires explicit approval after passing review and exact-head CI;
  no direct main writes or unapproved merge. Do not manually contact teammates.

Next increment: implement the narrow authenticated begin/status contract,
transactional guard checks across every listed path, prior-token revocation,
exact learner cascade with explicit absence verification, and lost-response/
concurrency tests. Drain old writers before enabling any begins. Approve and
verify managed copy/restore handling before returning a completed receipt.
Pika migration 169 and its rollout remain separately owned and unauthorized here.

## Independent review evidence

Initial full-diff review of `69c3c91..816d277` on 2026-09-12:

- Sol/high: no actionable security/privacy/concurrency/migration findings.
- Terra/high: no merge blockers; one non-blocking scope-test gap. The assertion
  rejected learner alterations but did not cover other existing tables or
  UPDATE statements. One correction batch now checks every ALTER/CREATE TABLE
  target, both trigger targets, and data UPDATE statements.
- Budget: 4 of 5 reviewer launches used (initial Sol/Terra, targeted Terra,
  final Sol), 2 correction commits, approximately 10 elapsed review minutes. Terra targeted review of `816d277..1a9940b` found the
  test correction sound; its remaining handoff-label correction is recorded
  above. Final cumulative Sol integration review of `69c3c91..97d34e8`
  returned clean with no actionable findings. Limits
  remain 5 launches, 3 remediation batches, and 45 elapsed review minutes.

No database test, schema application, production erasure, or Claude review is
claimed by these source reviews. The future runtime fences and copy/retention
policy gates remain mandatory even after this schema PR passes CI and merges.

Migration 0013 SHA-256 (unchanged by review corrections):
`778cf0cf9ed9f700017a40d2359a88f3c3ec4b53afb3f1b01a9d02ec58a8d98b`.

Final reviewed source checkpoint: `97d34e8eab8009cee1a62861ea13387daeacbf40`.
This subsequent evidence-only ledger update changes no migration, schema,
contract, or tests. The approved publication/CI evidence follows.

## Approved CI and automatic preview evidence

[CI run 34727450111](https://github.com/codepetca/pal/actions/runs/34727450111)
at PR head `ff97d7c` applied `0000`–`0013` to its fresh PostgreSQL 16 service.
All 10 DB tests passed, including the 8 previously skipped contracts: populated
exact-scope erasure cascade, immutable bindings/receipt, tenant isolation, and
existing schema/upgrade checks. History and generation/no-drift checks passed.
Full CI failed four existing web assertions whose fixed 2026 fixtures omitted
`storyGrantAsOf`, allowing today's reconciliation to create already-due rewards.
The packed-widget check was consequently skipped; full CI was not green.

One test-only correction batch in `story-system.test.ts` (three tests) and
`story-grant-worker.test.ts` (one test) supplies the existing explicit clock seam.
Every assertion is preserved. No engine, scheduler, API, schema, or migration SQL
is changed by this batch. Source typecheck/lint are rerun; database execution is
through the same approved disposable PR CI. The fifth targeted Terra review returned clean: the fixed times preserve the
tests' observation points and do not mask their original assertions. Review
usage is now 5/5 launches and 3/3 correction batches; no further substantive
correction or reviewer launch is authorized without a fresh budget checkpoint.

The normal PR integration automatically built Vercel deployment
`dpl_eHukZM8jCJhuMdNuUzjvYbVFQzkL` for `events/profile-erasure-schema`, alias
`pal-git-events-profile-erasur-016610-stewarts-projects-cc2722c4.vercel.app`.
Read-only `vercel inspect` reports target `preview`, status `READY`. Build logs
show `node scripts/vercel-build.mjs` followed by widget/Next builds, with no
migration invocation. The script invokes migrations only for exact
`VERCEL_ENV=production`; preview skips that branch. Read-only preview environment
metadata (general and this git branch) returned zero configured variables,
including no `DATABASE_URL` or integration/read-token credentials. Persisted
sandbox routes are gated off in preview and the database client fails closed
without a URL. No credentials were read into the report or configured, and no
manual deployment or hosted schema application was initiated.

**Additional merge gate:** the existing production build automatically runs
`pnpm --filter @pal/db migrate` before building the app. Therefore approving only
a GitHub merge is insufficient here: before merging, verify the production
target and pending migrations and obtain explicit approval for the resulting
production deployment/schema application, or arrange a separately authorized
way to prevent that effect. Current approval covers disposable CI only. Also
required: one approving GitHub review under branch protection; independent
agent reviews do not fulfill that GitHub approval rule. No merge is authorized.

## Corrected source acceptance evidence

Corrected source SHA: `652676a3817ee5ccbecf57f240eecb2bb7133c49`.
[CI run 34727665102](https://github.com/codepetca/pal/actions/runs/34727665102)
passed completely: migrations `0000`–`0013`, all 10 DB tests, 68 engine tests,
170 widget tests, 253 web/API/persistence tests, 7 notification tests, workspace
typecheck/lint, history/no-drift, and packed-widget React 18.3 verification.
Every executed test suite reported zero failures and zero skips. The four
previously failing assertions passed without changing assertions or runtime.

Full diff scope: the new migration and generated metadata; its Drizzle table,
exports and schema/inventory tests; provider contract/inventory and handoff docs;
corrections to outdated deletion claims in API/integration/data-model/DB docs;
and only the four fixture clocks in the two existing test files. There is no
production behavior change, new dependency, backfill, existing learner mutation,
erasure endpoint, or rollout activation. Migration 0013 still has the fingerprint
recorded above. Source-independent Sol/Terra review covers the schema/contract;
final targeted Terra covers the fixture correction. The final ledger-only commit
records this evidence and changes no reviewed implementation or tests. Verify its
actual PR-head CI result using PR #103's live checks before any merge decision.

Implementation acceptance stops at a reviewed schema PR. Merge, one approving
GitHub review, production-target preflight, and explicit authorization covering
the production deploy/migration effect remain outstanding gates. Production
schema has not been inspected or applied by this task. Provider erasure and full
Phase 3 remain incomplete.
