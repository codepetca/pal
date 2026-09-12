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
- PR/SHA: pending source verification and review; will record publication here.
- Source verification: full workspace typecheck and lint passed; migration history
  check passed; regeneration reports no schema drift; `git diff --check` passed.
  DB suite: 2 source tests passed, 8 PostgreSQL tests skipped without
  `DATABASE_URL`. PostgreSQL execution and independent review remain pending.
- Prescribed Claude `/code-review --comment` is not available in this task's
  callable tools. Independent Sol/high security/concurrency and Terra/high
  compatibility reviews are the available alternative, not a Claude pass.
- Schema application approval: pending for existing CI's fresh disposable
  PostgreSQL 16 service only, running migrations `0000`–`0013` and synthetic
  invariant/upgrade tests. Coordinator is requesting this exact permission;
  publication is held because opening the PR triggers this CI automatically.
  No existing local, shared sandbox, hosted, or production target is approved.
- Merge: requires explicit approval after passing review and exact-head CI;
  no direct main writes or unapproved merge. Do not manually contact teammates.

Next increment: implement the narrow authenticated begin/status contract,
transactional guard checks across every listed path, prior-token revocation,
exact learner cascade with explicit absence verification, and lost-response/
concurrency tests. Drain old writers before enabling any begins. Approve and
verify managed copy/restore handling before returning a completed receipt.
Pika migration 169 and its rollout remain separately owned and unauthorized here.
