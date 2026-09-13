# Immutable erasure policy prerequisite

Migration `0014_profile-erasure-policy.sql` adds only `policy_version` to the
existing guard. Drizzle generated the column, check, journal and snapshot from
`schema.ts`; the SQL adds an update trigger protecting the policy discriminator.
Applied migration 0013 and its existing trigger are unchanged.

All existing operations and inserts omitting the field get `strict-v1`, preserving
strict v1 receipt semantics whether pending or completed. `pika-live-v1` is the
only additional value. Neither policy can change after insert. No data is enrolled,
learner deleted, feature enabled, role granted, or old receipt upgraded here.
The later runtime must select the policy explicitly and enforce Pika eligibility.

The existing tenant/operation and tenant/profile uniqueness, pending-only insert,
monotonic completion, delete/truncate rejection, and integration retention remain
in force. Only the existing service's UPDATE(completed_at) privilege is needed;
no policy-update privilege is required. Schema owner/DDL trust is unchanged.

This is a migration-only prerequisite for the separate Pika live-policy runtime PR.
Local checks do not apply SQL. The repository's disposable PostgreSQL 16 CI service
applies committed migrations and tests both policy bindings using synthetic rows.
No persistent target is approved. Before any application, refresh migration
collision checks and review the exact migration hash, database/branch/role target,
lock impact and rollback plan. Apply the additive migration before runtime release;
rollback by retaining the column/trigger and disabling new begins, never by deleting
or rewriting evidence. Once v2 is enabled, old receipt serializers/writers cannot
be restored. Runtime rollout and exact Pika activation require separate approval.
