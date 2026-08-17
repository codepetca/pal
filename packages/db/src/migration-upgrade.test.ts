import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

function postgresViolation(error: unknown, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    candidate.code === code ||
    (candidate.cause !== undefined && postgresViolation(candidate.cause, code))
  );
}

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

test(
  "upgrade starts scheduling prospectively without historical schedule or reward backfill",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const sourceUrl = new URL(process.env.DATABASE_URL!);
    const databaseName = `pal_upgrade_${crypto.randomUUID().replace(/-/g, "")}`;
    const adminUrl = new URL(sourceUrl);
    adminUrl.pathname = "/postgres";
    const upgradeUrl = new URL(sourceUrl);
    upgradeUrl.pathname = `/${databaseName}`;
    const admin = new Pool({ connectionString: adminUrl.toString() });
    let upgrade: Pool | undefined;

    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      upgrade = new Pool({ connectionString: upgradeUrl.toString() });
      const migrations = (await readdir(migrationsDirectory))
        .filter((name) => /^\d{4}_.+\.sql$/.test(name))
        .sort();
      const preScheduleMigrations = migrations.filter((name) =>
        name < "0007_story_collectible_schedule.sql"
      );
      for (const migration of preScheduleMigrations) {
        await upgrade.query(await readFile(join(migrationsDirectory, migration), "utf8"));
      }

      const integrationId = crypto.randomUUID();
      const learnerId = crypto.randomUUID();
      const historicalEventId = crypto.randomUUID();
      const historicalFactId = crypto.randomUUID();
      await upgrade.query(
        `INSERT INTO integrations (id, slug, name, secret_hash)
         VALUES ($1, $2, 'Upgrade test', $3)`,
        [integrationId, `upgrade-${databaseName}`, `secret-${databaseName}`],
      );
      await upgrade.query(
        `INSERT INTO learners (id, integration_id, external_learner_id)
         VALUES ($1, $2, 'historical-learner')`,
        [learnerId, integrationId],
      );
      await upgrade.query(
        `INSERT INTO events (
           id, integration_id, learner_id, idempotency_key, event_type, occurred_at
         ) VALUES ($1, $2, $3, 'historical-event',
           'daily_log_week.configured', '2025-09-01T12:00:00Z')`,
        [historicalEventId, integrationId, learnerId],
      );
      await upgrade.query(
        `INSERT INTO learner_facts (
           id, integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, $4, 'daily_log_week.configured', 'historical-fact',
           'historical-period', '2025-09-01T12:00:00Z', $5, '2025-09-01T12:00:00Z')`,
        [historicalFactId, integrationId, learnerId, historicalEventId, {
          term_token: "historical-term",
          term_start_day: "2025-09-01",
          term_end_day: "2025-10-10",
          term_timezone: "America/Toronto",
          term_week_count: 6,
          week_index: 1,
          week_start_day: "2025-09-01",
        }],
      );

      await upgrade.query(
        await readFile(
          join(migrationsDirectory, "0007_story_collectible_schedule.sql"),
          "utf8",
        ),
      );

      assert.equal(
        Number((await upgrade.query(
          `SELECT count(*) AS count FROM story_collectible_schedules`,
        )).rows[0].count),
        0,
      );
      assert.equal(
        Number((await upgrade.query(
          `SELECT count(*) AS count FROM learner_reward_grants`,
        )).rows[0].count),
        0,
      );

      const scheduleWriter = await upgrade.connect();
      const factWriter = await upgrade.connect();
      try {
        await scheduleWriter.query("BEGIN");
        await scheduleWriter.query(
          `INSERT INTO story_collectible_schedules (
             learner_id, period_key, source_fact_id, due_at, created_at
           ) VALUES ($1, 'historical-period', $2,
             '2025-09-06T04:00:00Z', '2025-09-01T12:00:00Z')`,
          [learnerId, historicalFactId],
        );
        await assert.rejects(
          factWriter.query(
            `UPDATE learner_facts
             SET metadata = metadata || '{"week_index": 2}'::jsonb
             WHERE id = $1`,
            [historicalFactId],
          ),
          (error) => postgresViolation(error, "23514"),
        );
        await scheduleWriter.query("ROLLBACK");
      } finally {
        await scheduleWriter.query("ROLLBACK").catch(() => undefined);
        scheduleWriter.release();
        factWriter.release();
      }

      const currentEventId = crypto.randomUUID();
      await upgrade.query(
        `INSERT INTO events (
           id, integration_id, learner_id, idempotency_key, event_type, occurred_at
         ) VALUES ($1, $2, $3, 'current-event',
           'daily_log_week.configured', '2026-09-07T12:00:00Z')`,
        [currentEventId, integrationId, learnerId],
      );
      await upgrade.query(
        `INSERT INTO learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, 'daily_log_week.configured', 'current-fact',
           'current-period', '2026-09-07T12:00:00Z', $4, '2026-09-07T12:00:00Z')`,
        [integrationId, learnerId, currentEventId, {
          term_token: "current-term",
          term_start_day: "2026-08-31",
          term_end_day: "2026-10-09",
          term_timezone: "America/Toronto",
          term_week_count: 6,
          week_index: 2,
          week_start_day: "2026-09-07",
        }],
      );
      const schedule = await upgrade.query(
        `SELECT period_key, due_at
         FROM story_collectible_schedules
         ORDER BY period_key`,
      );
      assert.equal(schedule.rowCount, 1);
      assert.equal(schedule.rows[0].period_key, "current-period");
      assert.equal(
        new Date(schedule.rows[0].due_at).toISOString(),
        "2026-09-12T04:00:00.000Z",
      );
      assert.equal(
        Number((await upgrade.query(
          `SELECT count(*) AS count FROM learner_reward_grants`,
        )).rows[0].count),
        0,
      );
    } finally {
      await upgrade?.end();
      await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  },
);
