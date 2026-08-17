import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

test(
  "upgrade backfills typed schedule metadata without granting historical rewards",
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
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, 'daily_log_week.configured', 'historical-fact',
           'historical-period', '2025-09-01T12:00:00Z', $4, '2025-09-01T12:00:00Z')`,
        [integrationId, learnerId, historicalEventId, {
          term_start_day: "2025-09-01",
          term_end_day: "2025-10-10",
          term_timezone: "America/Toronto",
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
        1,
      );
      assert.equal(
        Number((await upgrade.query(
          `SELECT count(*) AS count FROM learner_reward_grants`,
        )).rows[0].count),
        0,
      );

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
          term_start_day: "2026-08-31",
          term_end_day: "2026-10-09",
          term_timezone: "America/Toronto",
          week_index: 2,
          week_start_day: "2026-09-07",
        }],
      );
      const schedule = await upgrade.query(
        `SELECT period_key, due_at
         FROM story_collectible_schedules
         ORDER BY period_key`,
      );
      assert.equal(schedule.rowCount, 2);
      assert.equal(schedule.rows[0].period_key, "current-period");
      assert.equal(
        new Date(schedule.rows[0].due_at).toISOString(),
        "2026-09-12T04:00:00.000Z",
      );
      assert.equal(schedule.rows[1].period_key, "historical-period");
      assert.equal(
        new Date(schedule.rows[1].due_at).toISOString(),
        "2025-09-06T04:00:00.000Z",
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
