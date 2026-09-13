import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { learners, profileErasureOperations, type Db } from "@pal/db";

export type LifecycleTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ProfileIdentity = { integrationId: string; externalLearnerId: string };

export class ProfileErasedError extends Error {
  constructor() { super("profile_erased"); }
}
export class LearnerScopeError extends Error {
  constructor() { super("Learner token scope does not match persisted state"); }
}

/** Protocol v1: SHA-256 UTF-8 JSON tuple, first 8 bytes, signed big endian.
 * UUID case is normalized; external references are byte-exact. Never change
 * this encoding without draining every old holder/writer first.
 */
export function profileLockKey(identity: ProfileIdentity): string {
  return createHash("sha256").update(JSON.stringify([
    "pal-profile-lifecycle-v1", identity.integrationId.toLowerCase(),
    identity.externalLearnerId,
  ]), "utf8").digest().readBigInt64BE(0).toString();
}

export async function lockProfileIdentity(tx: LifecycleTx, identity: ProfileIdentity) {
  await tx.execute(sql`SET LOCAL lock_timeout = '1500ms'`);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${profileLockKey(identity)}::bigint)`);
}

export async function assertProfileActive(tx: LifecycleTx, identity: ProfileIdentity) {
  const [guard] = await tx.select().from(profileErasureOperations).where(and(
    eq(profileErasureOperations.integrationId, identity.integrationId),
    eq(profileErasureOperations.externalLearnerId, identity.externalLearnerId),
  )).for("update").limit(1);
  // Guards are authoritative regardless of the activation setting.
  if (guard) throw new ProfileErasedError();
}

/** All callers supply a transaction; scope discovery precedes the advisory
 * lock, but authorization and mapping are reread after it at READ COMMITTED.
 */
export async function lockActiveLearner(
  tx: LifecycleTx, integrationId: string | undefined, learnerId: string,
) {
  const predicate = and(eq(learners.id, learnerId),
    ...(integrationId ? [eq(learners.integrationId, integrationId)] : []));
  const [discovered] = await tx.select().from(learners).where(predicate).limit(1);
  if (!discovered) throw new LearnerScopeError();
  await lockProfileIdentity(tx, discovered);
  await assertProfileActive(tx, discovered);
  const [current] = await tx.select().from(learners).where(and(
    eq(learners.id, learnerId),
    eq(learners.integrationId, discovered.integrationId),
    eq(learners.externalLearnerId, discovered.externalLearnerId),
  )).for("update").limit(1);
  if (!current) throw new LearnerScopeError();
  return current;
}

export function isLifecycleLockFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && ["55P03", "40P01", "40001"].includes(String(error.code))) return true;
  return "cause" in error && isLifecycleLockFailure(error.cause);
}

/** Retry only rolled-back transactions, at most three attempts. */
export async function lifecycleTransaction<T>(db: Db, work: (tx: LifecycleTx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await db.transaction(work, { isolationLevel: "read committed" }); }
    catch (error) {
      if (attempt >= 3 || !isLifecycleLockFailure(error)) throw error;
    }
  }
}
