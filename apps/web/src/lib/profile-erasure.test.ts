import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "@pal/db";
import { validErasureRequest, validErasureReceipt, erasureEnabled } from "./profile-erasure-contract";
import { beginProfileErasure, getProfileErasure, progressProfileErasure, PROFILE_RESOURCES, assertErasureInventory, type ManagedCopyPolicy } from "./profile-erasure";
import { profileLockKey, lockProfileIdentity, lockActiveLearner, lifecycleTransaction, ProfileErasedError, LearnerScopeError, isLifecycleLockFailure } from "./profile-lifecycle";
import { getOrCreateLearnerIdentity, provisionActiveLearner, processEventInDb, resetLearnerInDb, loadLearnerFromDb } from "./db-learner";
import { loadLearnerSnapshot, acknowledgeLearnerReward } from "./learner-snapshot";
import { setStoryRewardLoadout } from "./reward-loadout";
import { reconcileDueStoryGrantsForLearner, findLearnersWithDueStoryGrants } from "./story-grant-worker";
import { resolveIntegration } from "./integration-auth";
import { mintPalReadToken } from "./read-token";
import { POST as beginHttp } from "@/app/api/v1/integration/profile-erasures/route";
import { GET as statusHttp } from "@/app/api/v1/integration/profile-erasures/[operation_id]/route";
import { POST as mintHttp } from "@/app/api/v1/integration/read-token/route";
import { POST as eventHttp } from "@/app/api/v1/events/route";
import { GET as snapshotHttp } from "@/app/api/v1/learner/snapshot/route";
import { POST as ackHttp } from "@/app/api/v1/learner/rewards/[rewardId]/seen/route";
import { POST as equipHttp } from "@/app/api/v1/learner/reward-loadout/route";

const ref = () => `pika-membership-v1-${randomUUID().replaceAll("-", "")}`;
const request = () => ({ operation_id: randomUUID(), learner_id: ref() });
const event = { event_type: "platform.session.started", occurred_at: "2026-09-01T12:00:00.000Z", metadata: {} };
const syntheticProof: ManagedCopyPolicy = { verify: async () => ({
  policyVersion: "disposable-ci-fixture-v1", evidenceReference: "synthetic-only-no-managed-copies",
  managedCopiesAccountedFor: true, restoreSuppressionIndependent: true,
}) };
const secret = "erasure-runtime-synthetic-integration-secret-32";
process.env.PAL_INTEGRATION_SECRET = secret;
process.env.PAL_READ_TOKEN_SIGNING_SECRET = "erasure-runtime-synthetic-signing-secret-32";
const dbTest = { skip: !process.env.DATABASE_URL };
after(async () => { if (process.env.DATABASE_URL) await getPool().end(); });

function http(path: string, token = secret, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function tenant() {
  const id = randomUUID();
  await getPool().query("INSERT INTO integrations (id,slug,name,secret_hash) VALUES ($1,$2,'Synthetic runtime test',$2)", [id, id]);
  return id;
}
async function rows(id: string) {
  const result: Record<string, unknown[]> = {};
  for (const table of PROFILE_RESOURCES) {
    result[table] = (await getPool().query(`SELECT * FROM ${table} WHERE ${table === "learners" ? "id" : "learner_id"}=$1 ORDER BY 1`, [id])).rows;
  }
  return result;
}
async function holdIdentity(integrationId: string, externalLearnerId: string) {
  const client = await getPool().connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [profileLockKey({ integrationId, externalLearnerId })]);
  return async () => { await client.query("ROLLBACK"); client.release(); };
}
async function waitForWaiters(integrationId: string, externalLearnerId: string, count = 1) {
  const key = BigInt.asUintN(64, BigInt(profileLockKey({ integrationId, externalLearnerId })));
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await getPool().query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=$1::oid AND objid=$2::oid", [(key >> BigInt(32)).toString(), (key & BigInt(0xffffffff)).toString()]);
    if (result.rows[0].n >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("expected real PostgreSQL advisory lock waiters");
}

test("wire validation, default deny, and pinned full identity lock encoding", () => {
  const input = request();
  assert.ok(validErasureRequest(input));
  for (const invalid of [null, [], {}, { ...input, tenant: randomUUID() }, { ...input, learner_id: "raw-student" }, { ...input, learner_id: "*" }, { ...input, operation_id: input.operation_id.toUpperCase() }]) assert.equal(validErasureRequest(invalid), false);
  const id = "12345678-1234-4234-8234-123456789abc";
  assert.equal(erasureEnabled(id, ""), false);
  assert.equal(erasureEnabled(id, "*"), false);
  assert.equal(erasureEnabled(id, `${id},garbage`), false);
  assert.equal(erasureEnabled(id, id), true);
  const identity = { integrationId: id, externalLearnerId: "pika-membership-v1-0123456789abcdef0123456789abcdef" };
  assert.equal(profileLockKey(identity), "-2193080595197345877");
  assert.equal(profileLockKey({ ...identity, integrationId: id.toUpperCase() }), profileLockKey(identity));
  assert.notEqual(profileLockKey({ ...identity, integrationId: randomUUID() }), profileLockKey(identity));
  assert.notEqual(profileLockKey({ ...identity, externalLearnerId: `${identity.externalLearnerId}0` }), profileLockKey(identity));
  const receipt = { ...input, schema_version: 1, status: "pending", begun_at: "2026-09-01T12:00:00.000Z", completed_at: null };
  assert.ok(validErasureReceipt(receipt));
  for (const invalid of [{ ...receipt, status: "completed" }, { ...receipt, completed_at: receipt.begun_at }, { ...receipt, extra: true }, { ...receipt, begun_at: "2026-02-30T12:00:00.000Z" }, { ...receipt, status: "completed", completed_at: "2026-08-01T12:00:00.000Z" }]) assert.equal(validErasureReceipt(invalid), false);
});

test("durable begin, lost-response retry, tenant isolation, conflict precedence and concurrent insert winners", dbTest, async () => {
  const id = await tenant(); const other = await tenant(); const input = request();
  const first = await beginProfileErasure(getDb(), id, input);
  assert.equal(first.status, "pending");
  assert.deepEqual(await beginProfileErasure(getDb(), id, input), first);
  assert.deepEqual(await getProfileErasure(getDb(), id, input.operation_id), first);
  assert.equal(await getProfileErasure(getDb(), other, input.operation_id), null);
  assert.equal((await beginProfileErasure(getDb(), other, input)).operation_id, first.operation_id);
  const second = request(); await beginProfileErasure(getDb(), id, second);
  await assert.rejects(beginProfileErasure(getDb(), id, { ...second, operation_id: first.operation_id }), /operation_binding_conflict/);
  await assert.rejects(beginProfileErasure(getDb(), id, { ...input, operation_id: randomUUID() }), /profile_operation_conflict/);
  const race = request();
  const results = await Promise.allSettled([beginProfileErasure(getDb(), id, race), beginProfileErasure(getDb(), id, { ...race, learner_id: ref() })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.match(String(results.find(result => result.status === "rejected")?.reason), /operation_binding_conflict/);
  const sameProfile = request();
  const bindings = await Promise.allSettled([beginProfileErasure(getDb(), id, sameProfile), beginProfileErasure(getDb(), id, { ...sameProfile, operation_id: randomUUID() })]);
  assert.equal(bindings.filter(result => result.status === "fulfilled").length, 1);
  assert.match(String(bindings.find(result => result.status === "rejected")?.reason), /profile_operation_conflict/);
  assert.deepEqual(await progressProfileErasure(getDb(), id, input.operation_id), first);
  const completed = await progressProfileErasure(getDb(), id, input.operation_id, syntheticProof);
  assert.equal(completed?.status, "completed");
  assert.deepEqual(await progressProfileErasure(getDb(), id, input.operation_id, syntheticProof), completed);
  assert.deepEqual(await beginProfileErasure(getDb(), id, input), completed);
  await assert.rejects(getOrCreateLearnerIdentity(getDb(), id, input.learner_id), ProfileErasedError);
});

test("absent provisioning waits behind begin and both pending/completed generations stay fenced", dbTest, async () => {
  const id = await tenant(); const input = request();
  const release = await holdIdentity(id, input.learner_id);
  const begin = beginProfileErasure(getDb(), id, input);
  const provision = (async () => {
    await waitForWaiters(id, input.learner_id);
    return getOrCreateLearnerIdentity(getDb(), id, input.learner_id);
  })();
  const rejected = assert.rejects(provision, ProfileErasedError);
  try { await waitForWaiters(id, input.learner_id, 2); } finally { await release(); }
  await begin; await rejected;
  assert.equal((await getPool().query("SELECT count(*)::int n FROM learners WHERE integration_id=$1", [id])).rows[0].n, 0);
  await assert.rejects(processEventInDb(id, input.learner_id, event, randomUUID()), ProfileErasedError);
  await assert.rejects(resetLearnerInDb(id, input.learner_id), ProfileErasedError);
  await assert.rejects(loadLearnerFromDb(id, input.learner_id), ProfileErasedError);
});

test("earlier read holds begin until commit; later snapshot, ack, equip, duplicate ingest and stale scheduler fail closed", dbTest, async () => {
  const id = await tenant(); const input = request(); const delivery = randomUUID();
  await processEventInDb(id, input.learner_id, event, delivery);
  const learner = await getOrCreateLearnerIdentity(getDb(), id, input.learner_id);
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const read = loadLearnerSnapshot(id, learner, getDb(), { afterScopeVerified: async () => { ready(); await hold; } });
  await started;
  const begin = beginProfileErasure(getDb(), id, input);
  try { await waitForWaiters(id, input.learner_id); } finally { release(); }
  await read; await begin;
  await assert.rejects(loadLearnerSnapshot(id, learner), ProfileErasedError);
  await assert.rejects(acknowledgeLearnerReward(id, learner, randomUUID()), ProfileErasedError);
  await assert.rejects(setStoryRewardLoadout(getDb(), { integrationId: id, learnerId: learner, slot: "companion", rewardGrantId: null }), ProfileErasedError);
  await assert.rejects(processEventInDb(id, input.learner_id, event, delivery), ProfileErasedError);
  const before = await rows(learner);
  assert.equal((await reconcileDueStoryGrantsForLearner(learner, { asOf: new Date() })).granted, 0);
  assert.deepEqual(await rows(learner), before);
});

test("mint transaction holds provisioning lock through signing and begin; rollback leaves no phantom guard", dbTest, async () => {
  const id = await tenant(); const input = request();
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const mint = lifecycleTransaction(getDb(), async tx => {
    const learnerId = await provisionActiveLearner(tx, id, input.learner_id);
    ready(); await hold;
    return mintPalReadToken({ integrationId: id, learnerId });
  });
  await started;
  const begin = beginProfileErasure(getDb(), id, input);
  try { await waitForWaiters(id, input.learner_id); } finally { release(); }
  assert.ok((await mint).token); await begin;
  const rollback = request();
  await assert.rejects(lifecycleTransaction(getDb(), async tx => {
    await lockProfileIdentity(tx, { integrationId: id, externalLearnerId: rollback.learner_id });
    await tx.execute(sql`INSERT INTO profile_erasure_operations(integration_id,operation_id,external_learner_id) VALUES (${id},${rollback.operation_id},${rollback.learner_id})`);
    throw new Error("synthetic rollback");
  }), /synthetic rollback/);
  assert.equal(await getProfileErasure(getDb(), id, rollback.operation_id), null);
  assert.ok(await getOrCreateLearnerIdentity(getDb(), id, rollback.learner_id));
});

test("bounded lock timeout rolls back begin and does not weaken a pending guard", dbTest, async () => {
  const id = await tenant(); const input = request();
  const release = await holdIdentity(id, input.learner_id);
  const start = Date.now();
  try { await assert.rejects(beginProfileErasure(getDb(), id, input), isLifecycleLockFailure); }
  finally { await release(); }
  assert.ok(Date.now() - start < 9000);
  assert.equal(await getProfileErasure(getDb(), id, input.operation_id), null);
  await beginProfileErasure(getDb(), id, input);
  const releaseAgain = await holdIdentity(id, input.learner_id);
  try { await assert.rejects(progressProfileErasure(getDb(), id, input.operation_id, syntheticProof), isLifecycleLockFailure); }
  finally { await releaseAgain(); }
  assert.equal((await getProfileErasure(getDb(), id, input.operation_id))?.status, "pending");
});

async function populateAll(tenant: string, learner: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const [plan, chapter, event, fact, achievement, grant] = Array.from({ length: 6 }, () => randomUUID());
    await client.query("INSERT INTO achievement_periods (learner_id,period_key,anchor_at) VALUES ($1,'week-1','2026-08-31')", [learner]);
    await client.query("INSERT INTO story_plans (id,learner_id,term_key,term_start_day,story_id,story_version,total_periods) VALUES ($1,$2,'term-1','2026-08-31','synthetic',1,6)", [plan, learner]);
    for (let ordinal = 1; ordinal <= 6; ordinal++) {
      await client.query("INSERT INTO story_plan_chapters (id,story_plan_id,learner_id,period_number,period_key,chapter_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [ordinal === 1 ? chapter : randomUUID(), plan, learner, ordinal, ordinal === 1 ? "week-1" : null, `synthetic-${ordinal}`]);
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO events (id,integration_id,learner_id,idempotency_key,event_type,occurred_at) VALUES ($1,$2,$3,'config-1','daily_log_week.configured','2026-08-31T12:00:00Z')", [event, tenant, learner]);
    await client.query("INSERT INTO learner_facts (id,integration_id,learner_id,source_event_id,event_type,semantic_key,period_key,occurred_at,metadata) VALUES ($1,$2,$3,$4,'daily_log_week.configured','config-1','week-1','2026-08-31T12:00:00Z',$5)", [fact, tenant, learner, event, {
      term_token: "term-1", term_start_day: "2026-08-31", term_end_day: "2026-10-09", term_timezone: "America/Toronto", term_week_count: 6, week_start_day: "2026-08-31", week_index: 1,
    }]);
    await client.query("INSERT INTO weekly_rhythm_configs (learner_id,period_key,config_version,period_status,eligible_days,configured_at) VALUES ($1,'week-1',1,'open',5,now())", [learner]);
    await client.query("INSERT INTO achievement_instances (id,learner_id,achievement_key,scope_key,status,source_fact_id,period_key) VALUES ($1,$2,'synthetic','week-1','earned',$3,'week-1')", [achievement, learner, fact]);
    await client.query("INSERT INTO reward_notices (learner_id,achievement_instance_id,reward_key,title,description,seen_at) VALUES ($1,$2,'synthetic','Synthetic','Synthetic',now())", [learner, achievement]);
    await client.query("INSERT INTO learner_reward_grants (id,learner_id,kind,source_fact_id,story_plan_id,story_plan_chapter_id) VALUES ($1,$2,'story_chapter',$3,$4,$5)", [grant, learner, fact, plan, chapter]);
    await client.query("INSERT INTO learner_reward_loadouts (learner_id,slot,reward_grant_id) VALUES ($1,'companion',$2)", [learner, grant]);
    for (const table of ["economy", "pet_state", "world_state"]) {
      for (const id of [learner]) {
        await client.query(`INSERT INTO ${table} (learner_id) VALUES ($1)`, [id]);
      }
    }

    await client.query("UPDATE economy SET xp=42,xp_lifetime=1042,level=3 WHERE learner_id=$1", [learner]);
    await client.query("UPDATE pet_state SET mood='happy' WHERE learner_id=$1", [learner]);
    await client.query("UPDATE world_state SET stage=2,unlocked_object_ids='[\"synthetic-world\"]' WHERE learner_id=$1", [learner]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

test("all 15 populated resources erase atomically, unknown copies retain mapping, unrelated profiles and catalogs survive", dbTest, async () => {
  const id = await tenant(); const other = await tenant(); const input = request();
  const learner = await getOrCreateLearnerIdentity(getDb(), id, input.learner_id);
  const foreign = await getOrCreateLearnerIdentity(getDb(), other, input.learner_id);
  const classmate = await getOrCreateLearnerIdentity(getDb(), id, ref());
  const otherMembership = await getOrCreateLearnerIdentity(getDb(), id, ref());
  for (const [owner, target] of [[id, learner], [other, foreign], [id, classmate], [id, otherMembership]]) await populateAll(owner, target);
  const before = await rows(learner);
  for (const name of PROFILE_RESOURCES) assert.ok(before[name].length > 0, `fixture missing ${name}`);
  const neighbors = await Promise.all([foreign, classmate, otherMembership].map(rows));
  const integrationsBefore = (await getPool().query("SELECT * FROM integrations WHERE id=ANY($1::uuid[]) ORDER BY id", [[id, other]])).rows;
  const stale = await findLearnersWithDueStoryGrants(getDb(), { asOf: new Date("2026-10-10"), onlyLearnerIds: [learner], limit: 1 });
  assert.deepEqual(stale.learnerIds, [learner]);
  const pending = await beginProfileErasure(getDb(), id, input);
  assert.deepEqual(await progressProfileErasure(getDb(), id, input.operation_id), pending);
  assert.deepEqual(await rows(learner), before);
  await assert.rejects(getDb().transaction(async tx => {
    assert.equal((await progressProfileErasure(tx, id, input.operation_id, syntheticProof))?.status, "completed");
    for (const values of Object.values(await rowsInTransaction(tx, learner))) assert.equal(values.length, 0);
    throw new Error("synthetic connection rollback after cleanup");
  }), /synthetic connection rollback/);
  assert.deepEqual(await rows(learner), before);
  assert.deepEqual(await getProfileErasure(getDb(), id, input.operation_id), pending);
  const completed = await progressProfileErasure(getDb(), id, input.operation_id, syntheticProof);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.begun_at, pending.begun_at);
  for (const values of Object.values(await rows(learner))) assert.equal(values.length, 0);
  for (let i = 0; i < neighbors.length; i++) assert.deepEqual(await rows([foreign, classmate, otherMembership][i]), neighbors[i]);
  assert.deepEqual((await getPool().query("SELECT * FROM integrations WHERE id=ANY($1::uuid[]) ORDER BY id", [[id, other]])).rows, integrationsBefore);
  assert.equal((await reconcileDueStoryGrantsForLearner(stale.learnerIds[0], { asOf: new Date("2026-10-10") })).granted, 0);
  await assert.rejects(loadLearnerSnapshot(id, learner), LearnerScopeError);
  await assert.rejects(getOrCreateLearnerIdentity(getDb(), id, input.learner_id), ProfileErasedError);
  assert.deepEqual(await beginProfileErasure(getDb(), id, input), completed);
});

async function rowsInTransaction(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], learner: string) {
  const result: Record<string, unknown[]> = {};
  for (const name of PROFILE_RESOURCES) result[name] = (await tx.execute(sql`SELECT * FROM ${sql.identifier(name)} WHERE ${sql.identifier(name === "learners" ? "id" : "learner_id")} = ${learner}`)).rows;
  return result;
}

test("inventory drift and changed internal mapping fail closed", dbTest, async () => {
  await assert.rejects(getDb().transaction(async tx => {
    await tx.execute(sql`CREATE TABLE public.synthetic_unknown_profile_resource (learner_id uuid)`);
    await assertErasureInventory(tx);
  }), /erasure_inventory_unverified/);
  const id = await tenant(); const input = request();
  const learner = await getOrCreateLearnerIdentity(getDb(), id, input.learner_id);
  const release = await holdIdentity(id, input.learner_id);
  const reading = lifecycleTransaction(getDb(), tx => lockActiveLearner(tx, id, learner));
  const rejected = assert.rejects(reading, LearnerScopeError);
  try {
    await waitForWaiters(id, input.learner_id);
    await getPool().query("UPDATE learners SET external_learner_id=$1 WHERE id=$2", [ref(), learner]);
  } finally { await release(); }
  await rejected;
});

test("HTTP auth, strict errors, tenant allowlist, stable receipts, no-store and old JWT revocation with feature off", dbTest, async () => {
  const integration = await resolveIntegration({ slug: "pika", name: "Pika", secret });
  const input = request(); const path = "/api/v1/integration/profile-erasures";
  const check = async (response: Response, code: number, error?: string) => {
    assert.equal(response.status, code);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const body = await response.json();
    if (error) assert.deepEqual(body, { error });
    return body;
  };
  const learner = await getOrCreateLearnerIdentity(getDb(), integration.id, input.learner_id);
  const { token } = await mintPalReadToken({ integrationId: integration.id, learnerId: learner });
  delete process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS;
  await check(await beginHttp(http(path, "wrong", input)), 401, "unauthorized");
  await check(await beginHttp(http(path, token, input)), 401, "unauthorized");
  await check(await beginHttp(http(path, secret, input)), 403, "erasure_not_enabled");
  for (const body of [null, [], {}, { ...input, integration_id: integration.id }, { ...input, learner_id: "legacy-account" }]) await check(await beginHttp(http(path, secret, body)), 422, "invalid_erasure_request");
  await check(await beginHttp(new NextRequest(`http://localhost${path}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: "{" })), 422, "invalid_erasure_request");
  process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS = integration.id;
  const first = await check(await beginHttp(http(path, secret, input)), 202);
  assert.ok(validErasureReceipt(first));
  assert.deepEqual(await check(await beginHttp(http(path, secret, input)), 202), first);
  assert.deepEqual(await check(await statusHttp(http(`${path}/${input.operation_id}`), { params: Promise.resolve({ operation_id: input.operation_id }) }), 200), first);
  await check(await statusHttp(http(`${path}/bad`), { params: Promise.resolve({ operation_id: "bad" }) }), 422, "invalid_erasure_request");
  await check(await statusHttp(http(`${path}/${randomUUID()}`), { params: Promise.resolve({ operation_id: randomUUID() }) }), 404, "erasure_operation_not_found");
  await check(await beginHttp(http(path, secret, { ...input, operation_id: randomUUID() })), 409, "profile_operation_conflict");
  await check(await beginHttp(http(path, secret, { ...input, learner_id: ref() })), 409, "operation_binding_conflict");
  delete process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS;
  await check(await mintHttp(http("/api/v1/integration/read-token", secret, { learner_id: input.learner_id })), 410, "profile_erased");
  await check(await eventHttp(http("/api/v1/events", secret, { schema_version: 1, learner_id: input.learner_id, idempotency_key: randomUUID(), ...event })), 410, "profile_erased");
  await check(await snapshotHttp(http("/api/v1/learner/snapshot", token)), 401, "unauthorized");
  await check(await ackHttp(http("/api/v1/learner/rewards/seen", token, {}), { params: Promise.resolve({ rewardId: randomUUID() }) }), 401, "unauthorized");
  await check(await equipHttp(http("/api/v1/learner/reward-loadout", token, { slot: "companion", rewardGrantId: null })), 401, "unauthorized");
  await check(await beginHttp(http(path, secret, input)), 403, "erasure_not_enabled");
  await progressProfileErasure(getDb(), integration.id, input.operation_id, syntheticProof);
  process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS = integration.id;
  const completed = await check(await beginHttp(http(path, secret, input)), 200);
  assert.ok(validErasureReceipt(completed)); assert.equal(completed.status, "completed");
  delete process.env.PAL_PROFILE_ERASURE_INTEGRATION_IDS;
});
