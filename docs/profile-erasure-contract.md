# Membership profile erasure contract

Pal implements two explicitly selected policies on the same durable membership
guard. Both erase only the exact authenticated integration and opaque membership
generation, preserve other classes/classmates/integrations and shared catalogs,
and permanently fence the erased generation. This is Pal's provider contract;
Pika and Bara cleanup, Pika's worker, UI invalidation and fresh-rejoin transition
are separately owned. Pal completion alone does not complete a classroom purge.

## Policy and compatibility

| Contract | Selection | Completed means |
|---|---|---|
| strict v1 | Original two-field POST; GET without policy header | Existing strict live-data plus managed-copy and independent restore-suppression requirements satisfied |
| Pika live v1, receipt schema 2 | Explicit v2 POST; GET with `Pal-Erasure-Policy: pika-live-v1` | All 15 live profile resources absent, verified under the permanent live lifecycle fence; historical backups excluded |

The existing server-only `PAL_PROFILE_ERASURE_INTEGRATION_IDS` exact UUID
allowlist is the default-off activation gate for both contracts. Missing,
malformed or wildcard configuration denies every integration. V2 additionally
requires the **configured authenticated Pika integration**; a membership prefix
or request field cannot choose a tenant or grant Pika eligibility. The runtime
also verifies the exact durable integration's `pika` slug. Other integrations
retain v1 behavior even if their UUID is allowlisted.

Migration 0014 adds immutable `policy_version`, default `strict-v1`, to the
existing guard. ALL old pending and completed rows retain strict v1 semantics.
No transition, upgrade, downgrade, cancel, reset, reopen, receipt deletion, or
reuse is provided. New Pika live operations save `pika-live-v1` at begin.
Both POST retries and GET require the saved policy to match the selected policy;
a mismatch returns `409 {"error":"erasure_policy_conflict"}`. Old strict
validators remain unchanged and reject v2 receipts. Never reinterpret a saved
v1 completed receipt as a v2 attestation. Old serializers must be drained before
v2 activation; rolling back to an old serializer would mislabel v2 records.

## Backend protocol

POST `/api/v1/integration/profile-erasures` and GET
`/api/v1/integration/profile-erasures/:operation_id` use the existing backend
integration bearer credential, never a learner JWT. There are no tenant/body/query
scope overrides and no browser CORS access. POST accepts exactly one shape:

```json
{"operation_id":"12345678-1234-4234-8234-123456789abc","learner_id":"pika-membership-v1-0123456789abcdef0123456789abcdef"}
```

```json
{"schema_version":2,"policy":"pika-live-v1","operation_id":"12345678-1234-4234-8234-123456789abc","learner_id":"pika-membership-v1-0123456789abcdef0123456789abcdef"}
```

`operation_id` is a canonical lowercase UUID. `learner_id` is exactly
`pika-membership-v1-` plus 32 lowercase hex characters, minted by Pika as an opaque
random membership generation; it is not a raw account/student/classroom ID.
GET has no body or query. For v2, its exact header is
`Pal-Erasure-Policy: pika-live-v1`; omit it for v1. Other header values, or this
header on POST, are rejected with 422 rather than negotiating ambiguously.

Begin commits the permanent guard before attempting cleanup. POST returns 202
while pending and 200 if completed (including when the first call completes).
GET only reads saved status and returns 200; retry the exact POST to progress.
Exact retries preserve operation, reference, policy, begun time and completed time.
A missing learner still needs a durable guard, verified inventory and mapping
absence under the provisioning fence. A 404 is never proof of erasure.

The v1 receipt has exactly `{schema_version:1, operation_id, learner_id, status,
begun_at, completed_at}`. V2 has exactly these nine keys:

```json
{
  "schema_version": 2,
  "policy": "pika-live-v1",
  "operation_id": "12345678-1234-4234-8234-123456789abc",
  "learner_id": "pika-membership-v1-0123456789abcdef0123456789abcdef",
  "status": "completed",
  "begun_at": "2026-09-13T12:00:00.000Z",
  "completed_at": "2026-09-13T12:00:01.000Z",
  "historical_backups": "excluded",
  "backup_retention": "not_attested"
}
```

`pending` requires null `completed_at`; `completed` requires a canonical UTC
millisecond timestamp at or after `begun_at`. The backup fields describe scope
for both statuses; only `completed` attests verified live absence.
All responses including errors and unsupported methods use `Cache-Control: no-store`.
Validation errors never echo inputs; credentials, profile payloads and database
query parameters are not logged by this boundary.

| Response | Meaning |
|---|---|
| 401 `unauthorized` | Missing/invalid integration credential or learner JWT used |
| 403 `erasure_not_enabled` | Default-off gate denied, or v2 requested by non-Pika integration |
| 422 `invalid_erasure_request` | Invalid exact shape, identity, query, or policy header |
| 404 `erasure_operation_not_found` | Unknown operation in authenticated integration |
| 409 `operation_binding_conflict` | Operation already names another reference; takes precedence |
| 409 `erasure_policy_conflict` | Exact operation/reference exists under a different policy |
| 409 `profile_operation_conflict` | Profile already names another operation |
| 503 `erasure_pending` | Progress/read failed; not completion evidence |

A foreign tenant's operation is indistinguishable from unknown. The same operation
UUID in two integrations denotes independent operations. A lost response, timeout,
5xx, malformed receipt, wrong binding or wrong policy never establishes completion.
Guard commit can precede such a failure; GET/retry preserves durable recovery.

## Live scope and direct verification

The inventory is derived from `packages/db/src/schema.ts` and migrations through
0014. Pal has one primary pooled PostgreSQL profile data path. The runtime checks
declared tables and deployed public stored relations against this exact list plus
shared `integrations` and `profile_erasure_operations`. New/missing tables,
materialized views or foreign tables fail closed. Under the exact identity lock,
it captures the learner UUID, deletes only that root, directly checks each owned
table by stored learner UUID (including indirect children), checks the external
mapping again, then completes in the same transaction. Failure rolls back deletion
so a pending operation retains the mapping necessary to retry every check.

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


Append-only child triggers permit the existing learner-root cascade. Integrations,
static rule/story/art catalogs and other memberships are untouched. There is no
Pal account-level resource to delete. A new generation gets a new random reference
and new state; it cannot reuse an old guard or recover old progression.

## Historical backup exclusion and live boundaries

For `pika-live-v1`, historical Neon PITR, WAL, cold backups, historical inactive
clones, and retained historical log/export copies are outside completion scope.
Their contents may remain under the provider's actual retention policy; expiry is
**unknown until verified**, and no retention duration is set or changed here.
They are retained, not physically erased. V2 does not promise that an administrator
restoring an old database cannot bring old data back. Backup physical absence,
restore-independent suppression and restoration tests do not block live completion.
These exclusions do not change the old strict-v1 policy.

An active serving replica, cache, current provider store, or in-flight writer is
live even if someone calls it a backup. Such a path must be fenced and cleaned
before this policy is activated for that deployment. Current source/config uses
one pooled database and no durable profile object store or server cache. HTTP
responses use no-store; widget/provider tokens and snapshots are client memory.
The normal release preflight must verify that deployed live topology matches this
source and all current writers use the fence. A concrete unknown live path or
failed deletion blocks activation/completion; do not classify it as historical.
No additional runtime attestation JSON, blanket copy-proof flag or backup registry
is introduced. Provider deployment evidence belongs in the normal release record.

Both pending and completed guards deny old-reference provision, mint, ingest
(including duplicate delivery), reset, reads, reward writes and scheduler activity.
These fences stay effective with activation disabled. Requests already authorized
before begin may have delivered bytes: Pika must clear scoped memory and reject
stale in-flight responses on removal, class switch, logout and generation change.
Screenshots and unmanaged downloads cannot be retracted by this backend.

## Retained evidence and consumer handoff

The guard retains only tenant UUID, operation UUID, opaque reference, immutable
policy and begun/completed times. It is linkable pseudonymous evidence, not
anonymous data. It retains no internal learner UUID, content, event history,
classroom, actor or free-text diagnostic. Guard disposal is not part of retries.
The schema rejects identity/policy/time rewrites, completed inserts, deletion,
truncation, completion with an extant learner and reopening. A privileged DBA
can alter safeguards; that trust boundary is unchanged.

Pika adoption must bind its operation, membership generation, provider and tenant
configuration to **the exact selected receipt version and policy**, validate exact
keys/timestamps/status, and retain that contract when retrying. Use the v2 POST
shape and GET header above for new live-policy operations. Preserve old saved
strict operations without silently upgrading them. Only after local academic,
Pal and Bara live cleanup is verified may Pika release the re-add restriction and
create a fresh generation. Pika offers no restore-student action. This Pal PR
neither changes those Pika transitions nor claims full end-to-end completion.

See [runtime and release preflight](profile-erasure-runtime.md) and the separate
[0014 migration prerequisite](profile-erasure-policy-migration.md).
