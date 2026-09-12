import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableName, is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema";

const ownedTables = [
  "achievement_instances", "achievement_periods", "economy", "events",
  "learner_facts", "learner_reward_grants", "learner_reward_loadouts", "learners",
  "pet_state", "reward_notices", "story_collectible_schedules",
  "story_plan_chapters", "story_plans", "weekly_rhythm_configs", "world_state",
].sort();

test("inventory covers every persisted table and every owned table has a root cascade", () => {
  const tables = Object.values(schema).filter((value) => is(value, Table));
  assert.deepEqual(tables.map(getTableName).sort(),
    [...ownedTables, "integrations", "profile_erasure_operations"].sort());
  const reachable = new Set(["learners"]);
  for (let pass = 0; pass < tables.length; pass++) {
    for (const table of tables) {
      const config = getTableConfig(table);
      if (config.foreignKeys.some((fk) => fk.onDelete === "cascade" &&
        reachable.has(getTableName(fk.reference().foreignTable)))) {
        reachable.add(config.name);
      }
    }
  }
  assert.deepEqual([...reachable].sort(), ownedTables);
  const guard = getTableConfig(schema.profileErasureOperations);
  assert.deepEqual(guard.columns.map((column) => column.name).sort(),
    ["begun_at", "completed_at", "external_learner_id", "integration_id", "operation_id"]);
  assert.equal(guard.foreignKeys.length, 1);
  assert.equal(guard.foreignKeys[0].onDelete, "restrict");
  assert.equal(getTableName(guard.foreignKeys[0].reference().foreignTable), "integrations");
  assert.deepEqual(guard.primaryKeys[0].columns.map((column) => column.name),
    ["integration_id", "operation_id"]);
  assert.deepEqual(guard.uniqueConstraints[0].columns.map((column) => column.name),
    ["integration_id", "external_learner_id"]);
});

test("migration adds only dormant evidence storage, with no existing-table writer or privilege grants", async () => {
  const migration = await readFile(new URL("../drizzle/0013_profile_erasure_operations.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /CREATE OR REPLACE|GRANT\s|ALTER TABLE\s+"?learners|INSERT INTO\s|DELETE FROM\s/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.profile_erasure_operations FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.preserve_profile_erasure_operation\(\) FROM PUBLIC/);
  assert.equal((migration.match(/CREATE TRIGGER/g) ?? []).length, 2);
  assert.match(migration, /BEFORE TRUNCATE ON public\.profile_erasure_operations/);
});

async function violation(client: PoolClient, statement: string, values: unknown[], code: string) {
  await client.query("SAVEPOINT rejected_write");
  await assert.rejects(client.query(statement, values), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code);
  await client.query("ROLLBACK TO SAVEPOINT rejected_write");
  await client.query("RELEASE SAVEPOINT rejected_write");
}

// This is a real PostgreSQL contract, not an in-memory simulation. It is skipped
// without DATABASE_URL. All synthetic rows and attempted writes roll back.
test("database bindings, monotonic evidence, complete root cascade, and tenant isolation", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [tenant, otherTenant, operation, learner, otherLearner, sibling] =
      Array.from({ length: 6 }, () => crypto.randomUUID());
    const ref = `pika-membership-v1-${crypto.randomUUID().replace(/-/g, "")}`;
    const otherRef = `pika-membership-v1-${crypto.randomUUID().replace(/-/g, "")}`;
    for (const id of [tenant, otherTenant]) {
      await client.query("INSERT INTO integrations (id, slug, name, secret_hash) VALUES ($1,$2,'Synthetic erasure test',$2)", [id, id]);
    }
    for (const [id, integration, external] of [[learner, tenant, ref], [otherLearner, otherTenant, ref], [sibling, tenant, otherRef]]) {
      await client.query("INSERT INTO learners (id,integration_id,external_learner_id) VALUES ($1,$2,$3)", [id, integration, external]);
    }
    const insert = "INSERT INTO profile_erasure_operations (integration_id,operation_id,external_learner_id) VALUES ($1,$2,$3)";
    await client.query(insert, [tenant, operation, ref]);
    await client.query(insert, [otherTenant, operation, ref]);
    await violation(client, insert, [tenant, operation, otherRef], "23505");
    await violation(client, insert, [tenant, crypto.randomUUID(), ref], "23505");
    await violation(client, insert, [crypto.randomUUID(), operation, ref], "23503");
    await violation(client, insert, [tenant, crypto.randomUUID(), "legacy-account-token"], "23514");
    const retried = await client.query(`${insert} ON CONFLICT DO NOTHING RETURNING *`, [tenant, operation, ref]);
    assert.equal(retried.rowCount, 0);
    const receipt = (await client.query("SELECT * FROM profile_erasure_operations WHERE integration_id=$1 AND operation_id=$2", [tenant, operation])).rows[0];
    for (const [column, value] of [["integration_id", otherTenant], ["operation_id", crypto.randomUUID()], ["external_learner_id", otherRef], ["begun_at", "2000-01-01"]]) {
      await violation(client, `UPDATE profile_erasure_operations SET ${column}=$1 WHERE integration_id=$2 AND operation_id=$3`, [value, tenant, operation], "23514");
    }
    await violation(client, "DELETE FROM profile_erasure_operations WHERE integration_id=$1", [tenant], "23514");
    await violation(client, "TRUNCATE profile_erasure_operations", [], "23514");
    await violation(client, "DELETE FROM integrations WHERE id=$1", [tenant], "23503");
    await violation(client, "UPDATE profile_erasure_operations SET completed_at=now() WHERE integration_id=$1", [tenant], "23514");
    await violation(client, "INSERT INTO profile_erasure_operations (integration_id,operation_id,external_learner_id,completed_at) VALUES ($1,$2,$3,now())", [tenant, crypto.randomUUID(), otherRef], "23514");

    // Populate every owned resource, including a pending schedule, a story grant,
    // equipped reward, and a seen notice. Catalog strings are synthetic.
    const [plan, chapter, event, fact, achievement, grant] = Array.from({ length: 6 }, () => crypto.randomUUID());
    await client.query("INSERT INTO achievement_periods (learner_id,period_key,anchor_at) VALUES ($1,'week-1','2026-08-31')", [learner]);
    await client.query("INSERT INTO story_plans (id,learner_id,term_key,term_start_day,story_id,story_version,total_periods) VALUES ($1,$2,'term-1','2026-08-31','synthetic',1,6)", [plan, learner]);
    for (let ordinal = 1; ordinal <= 6; ordinal++) {
      await client.query("INSERT INTO story_plan_chapters (id,story_plan_id,learner_id,period_number,period_key,chapter_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [ordinal === 1 ? chapter : crypto.randomUUID(), plan, learner, ordinal, ordinal === 1 ? "week-1" : null, `synthetic-${ordinal}`]);
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
      for (const id of [learner, otherLearner, sibling]) {
        await client.query(`INSERT INTO ${table} (learner_id) VALUES ($1)`, [id]);
      }
    }
    async function snapshot(id: string) {
      const rows: Record<string, unknown[]> = {};
      for (const table of ownedTables) {
        rows[table] = (await client.query(`SELECT * FROM ${table} WHERE ${table === "learners" ? "id" : "learner_id"}=$1 ORDER BY 1`, [id])).rows;
      }
      return rows;
    }
    const before = await snapshot(learner);
    for (const table of ownedTables) assert.ok(before[table].length > 0, `fixture missing ${table}`);
    const foreignBefore = await snapshot(otherLearner);
    const siblingBefore = await snapshot(sibling);
    await client.query("DELETE FROM learners WHERE id=$1 AND integration_id=$2 AND external_learner_id=$3", [learner, tenant, ref]);
    const after = await snapshot(learner);
    for (const table of ownedTables) assert.equal(after[table].length, 0, `residual ${table}`);
    assert.deepEqual(await snapshot(otherLearner), foreignBefore);
    assert.deepEqual(await snapshot(sibling), siblingBefore);
    await client.query("UPDATE profile_erasure_operations SET completed_at=now() WHERE integration_id=$1 AND operation_id=$2", [tenant, operation]);
    const completed = (await client.query("SELECT * FROM profile_erasure_operations WHERE integration_id=$1 AND operation_id=$2", [tenant, operation])).rows[0];
    assert.deepEqual({ ...completed, completed_at: null }, receipt);
    assert.ok(completed.completed_at);
    await client.query("UPDATE profile_erasure_operations SET completed_at=completed_at WHERE integration_id=$1", [tenant]);
    for (const expression of ["NULL", "completed_at + interval '1 second'"]) {
      await violation(client, `UPDATE profile_erasure_operations SET completed_at=${expression} WHERE integration_id=$1`, [tenant], "23514");
    }
    await violation(client, "DELETE FROM profile_erasure_operations WHERE integration_id=$1", [tenant], "23514");
    await violation(client, insert, [tenant, crypto.randomUUID(), ref], "23505");
    assert.equal((await client.query("SELECT * FROM profile_erasure_operations WHERE integration_id=$1 AND operation_id=$2", [crypto.randomUUID(), operation])).rowCount, 0);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    // No new HTTP/runtime behavior is claimed: old writers still ignore guards.
    // Activation must wait for the future locking/fencing API increment.
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
