# Membership erasure runtime — disabled pending approved release

This increment adds the explicit Pika live policy to the PR #104 lifecycle
runtime. Its separate migration-only prerequisite 0014 adds the immutable policy
binding; applied 0013 is unchanged. No queue, engine, lease, scheduled cleanup
worker, dependency, widget release, provider setting or hosted activation is added.
The [contract](profile-erasure-contract.md) defines exact request/receipt validation
and Pika consumer handoff. Old strict-v1 pending/completed operations are unchanged.

## Completion paths

The existing exact `PAL_PROFILE_ERASURE_INTEGRATION_IDS` allowlist remains unset
by default. New live operations require an explicit v2 request and authenticated
Pika identity; runtime DB lookup independently checks that integration's `pika`
slug. No request tenant or reference prefix confers eligibility. GET requires the
matching policy header and only reads status. POST retries perform progress.
Mixed-policy operations return conflicts, never policy conversion.

For strict-v1, `deployedCopyPolicy` still returns null, so the strict hosted path
remains pending and retains its mapping/data. It still requires genuine managed
copy evidence plus independent restore suppression before deletion. The Pika live
branch never calls that interface or fabricates its proof fields.

For `pika-live-v1`, the reviewed live inventory, primary transaction and live
lifecycle fences define the policy. After begin commits, progress verifies the
schema inventory, resolves the exact learner, cascades the root, directly checks
all15 resources and the exact mapping, and records completion atomically. A missing
learner still requires the same guard/inventory/mapping checks. Historical backup
contents can remain; no backup erasure, expiry, restore test or independent
suppression authority is required. Actual backup retention is unknown and the
v2 receipt explicitly does not attest it. No cold backup is physically erased.

The begin guard survives a later failed transaction. Delete/check/commit failures
roll back together, preserving the internal mapping for all direct child checks
on retry. Lock timeouts and provider/database failures never produce completion.
An already committed completion is durable and idempotently returned after a lost
response. There is no cancel, undo, reopen, receipt deletion or generation reuse.

## Serialization and anti-recreation

The unchanged identity key is SHA-256 of UTF-8 JSON
`["pal-profile-lifecycle-v1", lowercaseIntegrationUuid, exactExternalReference]`;
the first eight bytes are a signed big-endian PostgreSQL bigint. Collisions only
serialize; SQL always uses the full tenant/reference. Lock order is identity
advisory lock, operation row when present, learner row, then children. READ
COMMITTED ensures rereads see guards committed before lock acquisition.

Every public persisted path uses this protocol. Mint holds the fence through
signing. JWT and scheduler discovery only locate a key; mapping/tenant/guard are
reread under lock. A previously selected scheduler candidate cannot recreate a
purged learner. Old JWTs, duplicate events and provisioning fail closed for both
pending and completed generations, even when activation is switched off. Existing
worker bounds and transaction retries remain: at most three rolled-back lock,
deadlock or serialization retries with a 1.5-second lock timeout.

## Live topology and release preflight

Reviewed source: `packages/db/src/client.ts` has one pooled `DATABASE_URL` and
transactional node-postgres persistence. The API/lib source and committed config
contain no live profile replica routing, Redis cache, object storage or external
provider cleanup client. Shared static catalogs have no learner data. Widget
provider/sandbox state and read tokens exist in client memory; API responses are
no-store. Logs are sanitized rather than a serving data store. These are source
observations, not a claim that today's deployed infrastructure was audited.

Before separately approved activation, the normal release record must verify:

1. The exact target has 0014, canonical schema, reviewed privileges and no unknown
   active profile resource. Service access is SELECT/INSERT/UPDATE(completed_at)
   on guards, without DELETE/TRUNCATE/DDL; no new grants are made here.
2. Actual active data paths match the reviewed primary-database topology. Any
   real serving replica, cache or other current provider store is covered before
   activation. Extra public tables/materialized views/foreign tables block the
   runtime mechanically. Do not label an active store historical to skip it.
3. Every live writer, old minter, old receipt serializer, scheduled invocation and
   in-flight old application instance is drained or on the current fenced version.
   Current callers all serialize with begin; unfenced binaries cannot retain DB
   access. Historical snapshots alone are not live writers and do not block this.
4. Pika's exact authenticated integration UUID and explicit v2 adoption are
   approved. Pika clears scoped memory/rejects stale responses and coordinates
   all other live cleanup before allowing fresh rejoin.

No new runtime inventory JSON or generic copy-proof toggle is required. Record
actual live topology/writer checks in the ordinary deployment preflight. Historical
Neon PITR/WAL/backups, inactive clones and retained historical logs are excluded
from v2; neither their physical absence nor restore-suppression infrastructure is
an activation prerequisite. Do not invent expiry or change provider retention.

Migration-only PR and dependent runtime PR are separately reviewable. No shared,
hosted or local database is applied here. Any application requires an exact approved
migration/target packet; migration 0013 is immutable. Merge, runtime release,
privilege changes and integration activation each need separate authorization.
Once guards exist, lifecycle fences are a permanent rollback floor. Once v2 exists,
the policy-aware serializer is also a rollback floor. Disable new begins to halt
rollout; never restore old writers/serializers or reset saved evidence.

## Verification and independent review

Pure tests pin strict v1 and v2 validation, backup scope fields and exact identity
hash encoding. Existing fixture tests cover all fenced paths. New synthetic cases
cover old-policy binding stability, mixed-policy GET/POST/retry races, Pika-only
eligibility, absent-profile completion, populated15-resource deletion, database
failure/rollback/timeout, unknown active resources, unaffected neighbors, duplicate
old events, old JWTs, scheduler candidates and fresh generations without old state.

PostgreSQL contracts run only in the repository's existing disposable PostgreSQL16
CI service. Local checks use existing dependencies without installation and skip
DB tests. Canonical Drizzle generation/check validates migration consistency.
Claude Code is installed but logged out; no Claude review is claimed. The bounded
HQ PR Review fallback covers the cumulative fixed schema/runtime source once with
Sol/high (security/concurrency) and Terra/high (compatibility/coverage). The PRs
record actual head SHAs, CI outcomes, review evidence and any remaining limits.
