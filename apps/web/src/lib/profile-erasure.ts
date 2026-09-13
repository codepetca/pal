import { and, eq, getTableName, is, sql, Table } from "drizzle-orm";
import { schema, integrations, learners, profileErasureOperations, type Db, type ProfileErasureOperation } from "@pal/db";
import { lifecycleTransaction, lockProfileIdentity, type LifecycleTx, type ProfileIdentity } from "./profile-lifecycle";
import { validAnyErasureRequest, validErasureReceipt, validLiveErasureReceipt, requestPolicy, type AnyErasureRequest, type AnyErasureReceipt, type ErasurePolicy } from "./profile-erasure-contract";

export const PROFILE_RESOURCES = [
  "achievement_instances", "achievement_periods", "economy", "events",
  "learner_facts", "learner_reward_grants", "learner_reward_loadouts", "learners",
  "pet_state", "reward_notices", "story_collectible_schedules",
  "story_plan_chapters", "story_plans", "weekly_rhythm_configs", "world_state",
] as const;

export class ErasureConflict extends Error {
  constructor(readonly code: "operation_binding_conflict" | "profile_operation_conflict" | "erasure_policy_conflict") { super(code); }
}
function receipt(row: ProfileErasureOperation): AnyErasureReceipt {
  const value = {
    schema_version: 1, operation_id: row.operationId, learner_id: row.externalLearnerId,
    status: row.completedAt ? "completed" : "pending",
    begun_at: row.begunAt.toISOString(), completed_at: row.completedAt?.toISOString() ?? null,
  };
  if (row.policyVersion === "strict-v1" && validErasureReceipt(value)) return value;
  const live = { ...value, schema_version: 2, policy: row.policyVersion,
    historical_backups: "excluded", backup_retention: "not_attested" };
  if (row.policyVersion === "pika-live-v1" && validLiveErasureReceipt(live)) return live;
  throw new Error("invalid_saved_erasure_receipt");
}
const operationPredicate = (integrationId: string, operationId: string) => and(
  eq(profileErasureOperations.integrationId, integrationId),
  eq(profileErasureOperations.operationId, operationId),
);

async function requirePika(tx: LifecycleTx, integrationId: string) {
  const [integration] = await tx.select({ slug: integrations.slug }).from(integrations)
    .where(eq(integrations.id, integrationId)).limit(1);
  if (integration?.slug !== "pika") throw new Error("pika_erasure_scope_required");
}

export async function beginProfileErasure(db: Db, integrationId: string, request: AnyErasureRequest): Promise<AnyErasureReceipt> {
  if (!validAnyErasureRequest(request)) throw new Error("invalid_erasure_request");
  const policy = requestPolicy(request);
  return lifecycleTransaction(db, async tx => {
    await lockProfileIdentity(tx, { integrationId, externalLearnerId: request.learner_id });
    if (policy === "pika-live-v1") await requirePika(tx, integrationId);
    // DO NOTHING never rewrites a binding and avoids an aborted transaction on
    // either unique constraint. READ COMMITTED rereads a concurrent winner.
    await tx.insert(profileErasureOperations).values({
      integrationId, operationId: request.operation_id, externalLearnerId: request.learner_id, policyVersion: policy,
    }).onConflictDoNothing();
    const [operation] = await tx.select().from(profileErasureOperations)
      .where(operationPredicate(integrationId, request.operation_id)).for("update").limit(1);
    if (operation) {
      if (operation.externalLearnerId !== request.learner_id) throw new ErasureConflict("operation_binding_conflict");
      if (operation.policyVersion !== policy) throw new ErasureConflict("erasure_policy_conflict");
      return receipt(operation);
    }
    const [bound] = await tx.select().from(profileErasureOperations).where(and(
      eq(profileErasureOperations.integrationId, integrationId),
      eq(profileErasureOperations.externalLearnerId, request.learner_id),
    )).for("update").limit(1);
    if (bound) throw new ErasureConflict("profile_operation_conflict");
    throw new Error("erasure_binding_unavailable");
  });
}

export async function getProfileErasure(db: Db, integrationId: string, operationId: string,
  policy: ErasurePolicy = "strict-v1",
): Promise<AnyErasureReceipt | null> {
  const [discovered] = await db.select().from(profileErasureOperations)
    .where(operationPredicate(integrationId, operationId)).limit(1);
  if (!discovered) return null;
  return lifecycleTransaction(db, async tx => {
    await lockProfileIdentity(tx, discovered);
    const [current] = await tx.select().from(profileErasureOperations)
      .where(operationPredicate(integrationId, operationId)).for("update").limit(1);
    if (!current || current.externalLearnerId !== discovered.externalLearnerId) throw new Error("erasure_binding_unavailable");
    if (current.policyVersion !== policy) throw new ErasureConflict("erasure_policy_conflict");
    if (policy === "pika-live-v1") await requirePika(tx, integrationId);
    return receipt(current);
  });
}

/** A future approved implementation must attest all managed copies AND an
 * independently retained restore-suppression record for this exact binding.
 * No environment flag, request field, or runtime path can manufacture proof.
 */
export type ManagedCopyPolicy = {
  verify(identity: ProfileIdentity & { operationId: string }): Promise<{
    policyVersion: string; evidenceReference: string;
    managedCopiesAccountedFor: true; restoreSuppressionIndependent: true;
  } | null>;
};
export const deployedCopyPolicy: ManagedCopyPolicy = Object.freeze({ verify: async () => null });

export async function assertErasureInventory(tx: LifecycleTx) {
  const expected = [...PROFILE_RESOURCES, "integrations", "profile_erasure_operations"].sort();
  const declared = Object.values(schema).filter(value => is(value, Table)).map(getTableName).sort();
  const actual = await tx.execute<{ table_name: string }>(sql`
    SELECT c.relname AS table_name FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'm', 'f')
    ORDER BY c.relname`);
  if (JSON.stringify(declared) !== JSON.stringify(expected) ||
      JSON.stringify(actual.rows.map(row => row.table_name)) !== JSON.stringify(expected)) {
    throw new Error("erasure_inventory_unverified");
  }
}

export async function verifyProfileAbsent(tx: LifecycleTx, learnerId: string) {
  for (const name of PROFILE_RESOURCES) {
    const column = name === "learners" ? "id" : "learner_id";
    const result = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(name)} WHERE ${sql.identifier(column)} = ${learnerId} LIMIT 1`);
    if (result.rows.length) throw new Error("erasure_absence_unverified");
  }
}

/** Called only after begin commits. Strict v1 still needs managed-copy proof.
 * Pika live v1 uses the reviewed live inventory and lifecycle fences, and makes
 * no backup/restore claim. Deployment preflight must verify active topology.
 * Keep deletion and captured-UUID verification atomic: a pending receipt must
 * never lose the mapping needed for all indirect-child checks on retry.
 */
export async function progressProfileErasure(
  db: Db, integrationId: string, operationId: string,
  copyPolicy: ManagedCopyPolicy = deployedCopyPolicy,
  policy: ErasurePolicy = "strict-v1",
): Promise<AnyErasureReceipt | null> {
  const discovered = await getProfileErasure(db, integrationId, operationId, policy);
  if (!discovered || discovered.status === "completed") return discovered;
  return lifecycleTransaction(db, async tx => {
    const identity = { integrationId, externalLearnerId: discovered.learner_id };
    await lockProfileIdentity(tx, identity);
    const [operation] = await tx.select().from(profileErasureOperations)
      .where(operationPredicate(integrationId, operationId)).for("update").limit(1);
    if (!operation || operation.externalLearnerId !== identity.externalLearnerId) throw new Error("erasure_binding_unavailable");
    if (operation.policyVersion !== policy) throw new ErasureConflict("erasure_policy_conflict");
    if (policy === "pika-live-v1") await requirePika(tx, integrationId);
    if (operation.completedAt) return receipt(operation);
    await assertErasureInventory(tx);
    if (policy === "strict-v1") {
      const proof = await copyPolicy.verify({ ...identity, operationId });
      if (!proof || !proof.policyVersion || !proof.evidenceReference ||
          proof.managedCopiesAccountedFor !== true || proof.restoreSuppressionIndependent !== true) return receipt(operation);
    }
    const predicate = and(eq(learners.integrationId, integrationId), eq(learners.externalLearnerId, identity.externalLearnerId));
    const [learner] = await tx.select().from(learners).where(predicate).for("update").limit(1);
    if (learner) {
      await tx.delete(learners).where(and(predicate, eq(learners.id, learner.id)));
      await verifyProfileAbsent(tx, learner.id);
    }
    // Even an absent learner is checked again under the provisioning fence.
    const remaining = await tx.select({ id: learners.id }).from(learners).where(predicate).limit(1);
    if (remaining.length) throw new Error("erasure_absence_unverified");
    const [completed] = await tx.update(profileErasureOperations)
      .set({ completedAt: sql`clock_timestamp()` }).where(operationPredicate(integrationId, operationId)).returning();
    return receipt(completed);
  });
}
