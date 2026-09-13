# Membership profile erasure foundation

Status: proposed provider contract; schema-only foundation. No erasure endpoint,
revocation, ingestion fence, or cleanup worker is implemented by this increment.
The selected cross-project plan is the single [Pika classroom cleanup roadmap](https://github.com/codepetca/pika/blob/main/docs/guidance/classroom-pal-and-student-cleanup-plan.md)
(source checkpoint `6c8ab914`; until published, the coordinator's Pika worktree
contains the authoritative document). This is its first bounded Pal Phase 3
increment, not Phase 3 exit. See [handoff](profile-erasure-handoff.md).

## Identity and operation contract for the next API increment

The target is `(authenticated integration UUID, external learner reference)`.
Pika persists a random `pika-membership-v1-<32 lowercase hex>` reference for one
immutable classroom enrollment generation. It sends neither student nor classroom
IDs. Two integrations may use the same reference without sharing a learner.
A later re-add uses a new random reference; an erased generation never reopens.
Legacy account profiles are excluded. There is no reward copying or backfill.

Proposed endpoints (not available today):

- `POST /api/v1/integration/profile-erasures`: strict JSON body containing only
  `operation_id` (canonical lowercase UUID) and `learner_id` (the reference above).
  The integration chooses and persists the operation UUID before its first send.
- `GET /api/v1/integration/profile-erasures/:operation_id`: status within the
  authenticated integration. No body, tenant override, raw ID, or wildcard target.

Both use the existing backend integration bearer authentication. Widget JWTs
cannot authorize these operations. Authentication derives the integration UUID
server-side; the reference prefix does not itself confer authorization. Future
activation must explicitly allow approved integrations; this migration adds no
activation control or default-enabled destructive permission. Parse errors return
`422 {"error":"invalid_erasure_request"}` without echoing input. Missing/invalid
credentials return `401 {"error":"unauthorized"}`. A valid integration outside
the approved rollout returns `403 {"error":"erasure_not_enabled"}`.

A first valid begin commits one pending operation and the revocation boundary,
then returns `202`. A retry of the exact same tenant/operation/reference returns
the same operation and `202` while pending, or `200` once complete. There is no
cancel, reset, reopen, replace, or retry-with-a-new-ID operation. A reference
already bound to a different operation returns `409 {"error":"profile_operation_conflict"}`;
an operation bound to a different reference returns
`409 {"error":"operation_binding_conflict"}`. If both conflict, operation binding
wins. Do not resolve conflicts using an unscoped operation lookup. No upsert may
change identity columns. Concurrent insert conflicts are reread within the tenant
after transaction rollback/savepoint recovery, then classified using these rules.

GET returns `200` with the saved pending or completed receipt; an unknown operation
in that integration returns `404 {"error":"erasure_operation_not_found"}`. Another
integration's operation is indistinguishable from unknown. The same operation UUID
in two integrations identifies independent operations, never grants cross-tenant
access. A request cannot erase a foreign learner because no internal learner UUID
or tenant is accepted and deletion resolves the exact authenticated pair.

The strict receipt is `{schema_version: 1, operation_id, learner_id, status,
begun_at, completed_at}`. `status` is `pending` when `completed_at` is null and
`completed` otherwise; timestamps are UTC RFC3339, and the other values echo only
the authenticated operation's saved binding. `begun_at` and a committed completion
time never change. All responses, including errors, use `Cache-Control: no-store`;
no cross-origin browser access or credential-bearing logging is added.

A lost response, timeout, `5xx`, malformed receipt, or generic `404` is **not**
completion. Retry the exact begin or GET status. Transient failure after begin
leaves the durable operation pending and fenced; failure before commit cannot
promise revocation. A blocked copy/policy case also stays pending. The service
may return `503 {"error":"erasure_pending"}` on a begin retry that cannot progress;
GET still reports the saved state. There is no durable free-text error history,
step engine, lease system, or student-content diagnostic field in this table.

A missing learner at begin still creates a pending guard. Under the same
provisioning fence, the service verifies absence and the copy/cache requirements
before completing it. “Never provisioned” is not inferred from an HTTP 404.
Pika releases its re-add restriction only after validating the exact versioned
completed receipt and all other required providers' evidence.

## Persisted scope inventory at Pal main 69c3c91

The authoritative definitions are `packages/db/src/schema.ts` and migrations
`0000`–`0012`. `learners.integration_id` is required and has one owner; there is
no shared learner, user/account, membership join table, or cross-integration
mapping. Deleting an integration is broader than a profile and is forbidden for
this operation. The new table's `ON DELETE RESTRICT` deliberately prevents an
integration cascade from removing its retained receipts.

Each row below requires a zero-count check for the captured learner UUID before
recording completion. Where an indirect FK is used, also inspect the child table
by its stored `learner_id`, not only a join through an already-deleted parent.
These checks are future service obligations, not code shipped here.

| Persisted resource | Ownership/deletion path | Contents removed |
|---|---|---|
| `learners` | exact integration + external reference; root | internal mapping and creation time |
| `events` | learner and composite learner/integration cascades | all envelopes, metadata, delivery keys |
| `learner_facts` | event/learner/integration composite cascade | semantic keys, metadata, settlement and configuration markers |
| `achievement_periods` | learner cascade | opaque periods and ordering |
| `weekly_rhythm_configs` | learner and owned period cascades | opportunities, versions, reconciliation state |
| `story_plans` | learner cascade | term calendar and pinned story |
| `story_plan_chapters` | owned plan cascade; owned period FK | chapter bindings and progression schedule |
| `story_collectible_schedules` | owned source fact cascade | pending and reconciled due work |
| `achievement_instances` | learner cascade; source/period owner FKs | progress, earned outcomes, lifetime/item/weekly scopes |
| `reward_notices` | owned achievement cascade | notices and acknowledgement times |
| `learner_reward_grants` | owned plan/source fact cascades | title/story ownership and seen state |
| `learner_reward_loadouts` | owned grant cascade | equipped companion and wallpaper |
| `economy` | learner cascade | XP, lifetime XP, level, streak, last event |
| `pet_state` | learner cascade | mood, expiry, animation |
| `world_state` | learner cascade | stage and unlocked object IDs |

Append-only fact, plan, grant, and schedule triggers permit their documented
learner-deletion cascades; direct child deletion is not a substitute. Tests must
populate these resources, including earned rewards and pending scheduler work,
then exercise a real root cascade and verify every child, while comparing an
unrelated profile and a same-reference foreign integration before/after.
`integrations` and static rule/story/art catalogs are shared configuration and
must remain intact. Planned `AuditLog`, `LearnerGroup`, generalized `UnlockLedger`,
Redis locks/cache, and object storage in architecture diagrams are not persisted
profile resources in the reviewed source. Future additions must extend this
inventory and completion verification before rollout.

## Paths to fence in the next implementation

| Path | Current code and required lifecycle integration |
|---|---|
| Event ingestion | `api/v1/events/route.ts`, `lib/db-learner.ts`: `getOrCreateLearnerIdentity` currently provisions before the learner row lock; check the guard before even duplicate-event acceptance, then apply the existing engine transaction |
| Token provisioning | `api/v1/integration/read-token/route.ts`: same identity helper, currently can create without gameplay; check guard inside provisioning transaction and hold it through minting |
| Snapshot reads | `lib/learner-snapshot.ts`: repeatable-read snapshot with tenant/learner lookup; add lifecycle serialization and current committed guard check before reading |
| Reward acknowledgements | `acknowledgeLearnerReward`: currently checks tenant before its update transaction, without learner lock; move scope/fence check inside that transaction |
| Loadout writes | `lib/reward-loadout.ts`: already takes tenant/learner row lock; add outer identity lock and guard check |
| Facts, awards, plans | `achievement-state.ts`, `story-plan.ts`, `reward-grants.ts`, `story-grant-reconciler.ts`: remain inside existing owning transaction; no separate rule-engine mutation path |
| Scheduler | `story-grant-worker.ts`, cron route: candidate discovery is advisory; resolve exact identity, lock, recheck existence and guard before reconciling; a previously selected candidate must not grant after begin |
| Sandbox | sandbox events/read-token/reset routes and `resetLearnerInDb`: local persisted synthetic paths only; must obey lifecycle fences if a guarded identity is reachable. Never expose reset as production erasure |
| Widget and host memory | `packages/widget/src/provider.tsx` and HTTP client, Pika token/provider caches: invalidate scope and reject stale in-flight responses; sandbox client also caches tokens in memory |

Use the pooled PostgreSQL interactive transactions already required by Pal. The
new lifecycle protocol adds one transaction-scoped advisory lock keyed by a
stable hash of a domain separator plus the **entire integration UUID and external
reference**, before the existing learner row lock. Pin the hash algorithm/key
encoding in implementation tests. A collision may serialize unrelated profiles
but must never change a SQL ownership predicate. Every provisioning, begin,
retry/completion, read, and write path must use the identical key and lock order:
identity advisory lock → operation row (when present) → learner row → children.
The absent learner/operation case is why a learner row lock alone is insufficient.

For JWT or scheduler callers starting with an internal learner UUID, an initial
lookup may discover the external key, but its result is untrusted until reread
under the identity lock. A missing or changed mapping fails closed. Guard lookup
and identity reread must observe a snapshot taken **after** acquiring the lock:
use READ COMMITTED for this serialized transaction, not the current pre-lock
repeatable-read snapshot. Never acquire the learner lock and then the identity
lock. Lock timeouts roll back and retry with bounded limits; they do not complete
an operation. A begin waits for earlier holders, inserts its guard, and commits
before responding accepted. Later holders see the guard and deny all activity.

Previously issued JWTs need no mass key rotation: all read/ack/equip routes must
consult the current database guard and tenant mapping even when the signature
and five-minute expiry remain valid. Return `410 {"error":"profile_erased"}` for
an integration's guarded external-reference ingest or mint request; JWT routes
may use a generic authorization denial without exposing the external reference.
Both pending and completed guards deny reuse. This behavior is not provided by
this migration, and old binaries must be drained before accepting any begin.
A read authorized before begin may already be on the wire; server revocation
cannot retract delivered pixels/bytes. Pika must discard stale responses and
clear its scoped UI/token memory. Do not promise erasure of user screenshots or
unmanaged downloaded copies.

## Minimal retained evidence, privileges, and completion

`profile_erasure_operations` holds only integration UUID, operation UUID, opaque
reference, begun time, and nullable completed time. There is no retained internal
learner UUID, event ID, content, classroom ID, actor ID, reason, or payload.
The exact random reference is retained so credential rotation cannot break the
guard. It remains linkable pseudonymous data, not anonymous data. Its existence
is the permanent identity fence; null completion denotes unfinished erasure.
The table deliberately has no cascading learner FK. The tenant/operation primary
key and tenant/reference unique constraint provide both indexed lookups and
conflict serialization without another queue/index/workflow table.

The migration rejects identity/time rewrites, deletion, truncation, completion
at insert, and any reset of recorded completion. Completion with a still-present
exact learner fails. These are database invariants on the new table only; they
do not enforce fences on old writers, prove cache absence, or certify backup
handling. No SQL statement in this migration deletes a learner or enrolls data.
The new table and trigger function revoke all PUBLIC privileges; no application
role or destructive capability is granted. Existing explicit/default role grants
must be audited at application time. The current database owner remains trusted
and can alter/drop/disable schema safeguards; this is not protection from a
privileged DBA. Future runtime access should be limited to SELECT, INSERT, and
UPDATE(completed_at) for the service, without DELETE/TRUNCATE/DDL, using existing
role provisioning conventions and separate approval where needed. Integrations
never receive SQL access; SQL uniqueness is not an HTTP authentication check.

The future worker deletes only the learner resolved under the exact identity
lock, verifies every inventory row absent in that transaction, and commits the
receipt only after all required managed cache/copy evidence is satisfied. A SQL
completion check is necessary but insufficient. No other profile may be selected
by shared student, classroom, term, event key, or integration alone.

No durable learner cache or profile object upload store was found in the reviewed
source. HTTP responses use no-store, while provider/sandbox snapshots, tokens,
and pending celebrations live in client memory. Static assets and compiled
catalogs contain no profile data and are not deleted. Hosting logs, database WAL,
Neon branches/point-in-time recovery/backups, replicas, exports, support copies,
and host-owned Pika/Gradex/Bara copies cannot be proven absent from source review.
Before enabling completion, an operator must inventory actual deployed copies,
approve their expiry/deletion or exclusion-on-restore policy, and provide tested
restore suppression using the retained guard outside any older restored snapshot.
Restoring the primary and its old tombstone table together is not sufficient.
Unknown copy classes keep the operation pending and block rollout for those cases.

Owner decisions still required: duration and eventual disposition of minimal
guard/receipt retention; treatment and retention of managed backups/logs/exports;
where a restore-independent suppression record lives; scope of any physical
versus logical erasure claim; treatment of integration retirement. This document
sets no retention duration or two-day guarantee. Removing guards or integration
records requires a separate approved design, never a “retry” operation. No
legacy-profile retirement or historical removed-student backfill is authorized.
