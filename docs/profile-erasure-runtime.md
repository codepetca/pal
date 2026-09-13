# Membership erasure runtime — release and activation remain blocked

This increment implements the Pal provider portion of Phase 3 against migration
0013 (released in PR #103, main `38a4b443`). It adds no migration, dependency,
queue, scheduler, widget release, or hosted configuration. The schema-only
handoff's release-pending statements are superseded by that release. The
[provider contract](profile-erasure-contract.md) remains the wire and scope
contract. Pika's adapter, automatic cleanup worker, host memory invalidation,
copy policy, pilot and full Phase 3 exit remain separately owned.

## Backend protocol

POST `/api/v1/integration/profile-erasures` accepts exactly `operation_id` and
`learner_id`; GET `/api/v1/integration/profile-erasures/:operation_id` returns
only the authenticated integration's receipt. Both require the existing backend
integration bearer credential, not a learner JWT. No query overrides or browser
CORS permission are added. All responses, including unsupported-method errors,
use no-store. Validation errors never echo request content.

`PAL_PROFILE_ERASURE_INTEGRATION_IDS` is a server-only exact UUID allowlist.
Missing, malformed or wildcard configuration denies every integration. It must
remain unset in hosted environments for this increment. It does not control
revocation: every pending and completed guard always denies old-generation
provisioning, events (including duplicate delivery), reads and writes.

A begin transaction inserts the permanent guard and commits before any progress
attempt. Exact retries preserve operation identity and times. Operation binding
conflict has precedence over profile binding conflict, with tenant-scoped
rereads following conflict-safe inserts. A lost response or any 5xx is not proof
of completion: retry the exact begin or GET. There is no cancel/reset/reopen.

## Serialization and live scope

The identity key is SHA-256 of the UTF-8 JSON tuple
`["pal-profile-lifecycle-v1", lowercaseIntegrationUuid, exactExternalReference]`.
Its first eight bytes are interpreted as a signed, big-endian PostgreSQL bigint.
Tests pin the encoding. Hash collisions only serialize work; all SQL predicates
still use the full identity. Order is identity advisory lock, operation row when
present, learner row, then children. Transactions use READ COMMITTED so guard
and mapping rereads observe commits after acquiring the advisory lock.

Every public persisted entrypoint uses the same fence. Token provisioning holds
it through signing. JWT/scheduler internal UUID lookups only discover a key;
the current tenant and mapping are rechecked under lock before any child access.
Scheduler discovery is advisory, including candidates selected before begin.
The existing worker owns scheduling and retains its bounded retries. Other
lifecycle transactions retry only rolled-back lock/deadlock/serialization
failures, at most three attempts with a 1.5-second transaction-local lock timeout.
Timeout never signals completion. Gameplay remains owned by the existing engine.

The live erasure transaction checks the declared and deployed public-table
inventory against the reviewed 15-resource list plus shared integration/guard
tables. Missing or new tables block progress. It captures the exact learner UUID,
deletes only that root, and directly checks every owned table by that UUID,
including indirect children. It never deletes integration or static catalogs.
A missing learner still requires a durable guard, inventory verification,
copy-policy evidence and an exact mapping absence check under the same fence.

## Copy-policy decision boundary

The deployed `ManagedCopyPolicy` returns no proof, unconditionally. No request
field, environment completion toggle or blanket production bypass exists.
Accordingly this release cannot complete a hosted erasure. Until an approved
policy implementation exists, a begun profile stays pending and inaccessible,
and its live mapping and rows remain retained. The operator must not activate
begin merely to create indefinitely pending removals.

Deletion and all captured-UUID checks happen in one transaction only after the
policy supplies explicit evidence for the exact integration/operation/reference:
a policy version, evidence reference, all managed copy classes accounted for,
and restore suppression retained independently of the restored primary.
Synthetic CI fixtures supply an explicit test policy because they contain only
synthetic disposable data. Production routes always use the blocked policy.
This is an internal implementation interface, not an operator attestation API.

Holding deletion until proof avoids losing the internal UUID between retries:
the permanent receipt intentionally retains no internal learner UUID. If any
verification or commit fails, the whole deletion rolls back while the previously
committed guard remains. Reusing the same begin/status operation requires no
new lease or workflow table. A future copy-policy implementation must be bounded,
reviewed, auditable and tied to real retained external evidence; this interface
does not establish such infrastructure or approve it.

The owner still must inventory Neon PITR/WAL, branches, backups, replicas, hosting
logs, exports and support copies; approve retention/deletion or exclusion on
restore; choose a restore-independent suppression authority; test restoration;
and approve the scope of logical versus physical erasure claims. No retention
duration, physical-copy deletion, two-day promise, or integration-retirement
policy is established here. Removing permanent guards requires a separate design.

## Required rollout and rollback floor

Before any later activation, separately approve the deployed copy inventory and
restore policy, runtime release, exact integrations and privileges. Audit the
service role for SELECT/INSERT/UPDATE(completed_at) on receipts without
DELETE/TRUNCATE/DDL. Do not replay migrations in shared or production targets
under this task. PR previews remain fixture-only, without database credentials
or migration execution.

Deploy every fenced path, drain all old application instances, in-flight writers,
old token minters and scheduler invocations, and verify no old binary can reach
the database before enabling begin. Once any guard is accepted, this runtime's
fences become a permanent rollback floor. Turning the begin allowlist off stops
new requests but must not bypass existing guards; never roll back to old writers
or reset receipts to recover an operation.

A read authorized before begin may already be delivered. Pika must clear scoped
token/provider memory and reject stale in-flight responses on removal, classroom
switch, logout and generation change. Delivered bytes, screenshots and unmanaged
downloads cannot be retracted by server revocation. No end-to-end client erasure
claim is made by this backend increment.

## Verification and review

Local checks cover types, lint, pure contracts, engine/widget regressions and a
fixture-only build. Database tests run only in the repository's authorized fresh
PostgreSQL 16 CI service with committed migrations 0000–0013 and synthetic data.
They exercise real advisory waits, concurrent binds/provisioning, bounded lock
timeouts, rollback, a populated 15-resource cascade, unaffected same-reference
foreign tenants/classmates/other memberships, stale scheduler candidates and
old JWTs after begin, with activation subsequently disabled.

No additional local/shared/hosted database is configured or migrated. Claude Code
is installed but `claude auth status` reports logged out; no Claude approval is
claimed. The independent review fallback is Sol/high for security/concurrency
and Terra/high for compatibility/coverage under the HQ PR Review budget. The PR
and external final handoff record the stable SHA, actual CI and review evidence.
Merge, deployment and activation require separate explicit approval.
