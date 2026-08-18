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

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for PostgreSQL state");
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

      const migrationSql = await readFile(
        join(migrationsDirectory, "0007_story_collectible_schedule.sql"),
        "utf8",
      );
      const lockHolder = await upgrade.connect();
      const migrationClient = await upgrade.connect();
      const concurrentWriter = await upgrade.connect();
      try {
        await lockHolder.query("BEGIN");
        await lockHolder.query("LOCK TABLE learner_facts IN ROW EXCLUSIVE MODE");
        const migrationPid = Number(
          (await migrationClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
        );
        const migrationStartedAt = Date.now();
        const migrationAttempt = migrationClient.query(migrationSql).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        await waitFor(async () => {
          const waiting = await concurrentWriter.query(
            `SELECT wait_event_type
             FROM pg_stat_activity
             WHERE pid = $1`,
            [migrationPid],
          );
          return waiting.rows[0]?.wait_event_type === "Lock";
        });

        const concurrentEventId = crypto.randomUUID();
        await concurrentWriter.query(
          `INSERT INTO events (
             id, integration_id, learner_id, idempotency_key, event_type, occurred_at
           ) VALUES ($1, $2, $3, 'migration-concurrent-event',
             'daily_log_week.configured', '2026-08-31T12:00:00Z')`,
          [concurrentEventId, integrationId, learnerId],
        );
        const concurrentFactInsert = concurrentWriter.query(
          `INSERT INTO learner_facts (
             integration_id, learner_id, source_event_id, event_type, semantic_key,
             period_key, occurred_at, metadata, created_at
           ) VALUES ($1, $2, $3, 'daily_log_week.configured',
             'migration-concurrent-fact', 'migration-concurrent-period',
             '2026-08-31T12:00:00Z', $4, '2026-08-31T12:00:00Z')`,
          [integrationId, learnerId, concurrentEventId, {
            term_token: "migration-concurrent-term",
            term_start_day: "2026-08-31",
            term_end_day: "2026-10-09",
            term_timezone: "America/Toronto",
            term_week_count: 6,
            week_index: 1,
            week_start_day: "2026-08-31",
          }],
        );

        const migrationResult = await migrationAttempt;
        assert.equal(migrationResult.ok, false);
        if (migrationResult.ok) throw new Error("migration unexpectedly succeeded");
        assert.ok(postgresViolation(migrationResult.error, "55P03"));
        assert.ok(Date.now() - migrationStartedAt < 5_000);
        await concurrentFactInsert;
      } finally {
        await lockHolder.query("ROLLBACK").catch(() => undefined);
        lockHolder.release();
        migrationClient.release();
        concurrentWriter.release();
      }

      await upgrade.query(migrationSql);

      assert.equal(
        Number((await upgrade.query(
          `SELECT count(*) AS count FROM story_collectible_schedules`,
        )).rows[0].count),
        0,
      );

      const insertOldWriterFact = async (
        name: string,
        metadata: Record<string, unknown>,
      ): Promise<void> => {
        const sourceEventId = crypto.randomUUID();
        const writer = await upgrade!.connect();
        try {
          await writer.query("BEGIN");
          await writer.query(
            `INSERT INTO events (
               id, integration_id, learner_id, idempotency_key, event_type, occurred_at,
               metadata
             ) VALUES ($1, $2, $3, $4,
               'daily_log_week.configured', '2026-08-31T12:00:00Z', $5)`,
            [sourceEventId, integrationId, learnerId, `${name}-event`, metadata],
          );
          await writer.query(
            `INSERT INTO learner_facts (
               integration_id, learner_id, source_event_id, event_type, semantic_key,
               period_key, occurred_at, metadata, created_at
             ) VALUES ($1, $2, $3, 'daily_log_week.configured', $4, $5,
               '2026-08-31T12:00:00Z', $6, '2026-08-31T12:00:00Z')`,
            [integrationId, learnerId, sourceEventId, `${name}-fact`, `${name}-period`, metadata],
          );
          await writer.query("COMMIT");
        } catch (error) {
          await writer.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          writer.release();
        }
      };

      await insertOldWriterFact("lowercase-timezone", {
        term_token: "lowercase-timezone-term",
        term_start_day: "2026-08-31",
        term_end_day: "2026-10-09",
        term_timezone: "america/toronto",
        term_week_count: 6,
        week_index: 1,
        week_start_day: "2026-08-31",
      });
      await insertOldWriterFact("calendarless-weekly-rhythm", {
        period_key: "calendarless-weekly-rhythm-period",
        config_version: 1,
        period_status: "open",
        eligible_days: 5,
      });
      assert.equal(Number((await upgrade.query(
        `SELECT count(*) AS count
         FROM learner_facts
         WHERE period_key = 'calendarless-weekly-rhythm-period'`,
      )).rows[0].count), 1);
      assert.equal(Number((await upgrade.query(
        `SELECT count(*) AS count
         FROM story_collectible_schedules
         WHERE period_key = 'calendarless-weekly-rhythm-period'`,
      )).rows[0].count), 0);
      const timezoneNames = new Set(
        (await upgrade.query(`SELECT lower(name) AS name FROM pg_timezone_names`))
          .rows.map((row) => String(row.name)),
      );
      const icuOnlyTimezone = [
        "Canada/East-Saskatchewan",
        "Canada/Eastern",
        "US/Eastern",
        "Mexico/General",
        "Brazil/East",
        "Australia/ACT",
      ].map((candidate) => {
        try {
          const canonical = new Intl.DateTimeFormat("en", {
            timeZone: candidate,
          }).resolvedOptions().timeZone;
          return { candidate, canonical };
        } catch {
          return undefined;
        }
      }).find((candidate) =>
        candidate !== undefined &&
        !timezoneNames.has(candidate.candidate.toLowerCase()) &&
        timezoneNames.has(candidate.canonical.toLowerCase())
      );
      assert.ok(icuOnlyTimezone, "test requires an ICU-valid PostgreSQL-absent alias");
      const icuAliasMetadata = {
        term_token: "icu-timezone-alias-term",
        term_start_day: "2026-08-31",
        term_end_day: "2026-10-09",
        term_timezone: icuOnlyTimezone.candidate,
        term_week_count: 6,
        week_index: 1,
        week_start_day: "2026-08-31",
      };
      await assert.rejects(
        insertOldWriterFact("icu-timezone-alias", icuAliasMetadata),
        (error) => postgresViolation(error, "23514"),
      );
      await insertOldWriterFact("icu-timezone-retry", {
        ...icuAliasMetadata,
        term_timezone: icuOnlyTimezone.canonical,
      });
      await assert.rejects(insertOldWriterFact("year-zero", {
        term_token: "year-zero-term",
        term_start_day: "0000-08-31",
        term_end_day: "0000-10-09",
        term_timezone: "America/Toronto",
        term_week_count: 6,
        week_index: 1,
        week_start_day: "0000-08-31",
      }), (error) => postgresViolation(error, "23514"));
      await assert.rejects(insertOldWriterFact("year-zero-cross-year", {
        term_token: "year-zero-cross-year-term",
        term_start_day: "0000-12-01",
        term_end_day: "0001-01-31",
        term_timezone: "America/Toronto",
        term_week_count: 6,
        week_index: 1,
        week_start_day: "0000-12-01",
      }), (error) => postgresViolation(error, "23514"));
      assert.equal(Number((await upgrade.query(
        `SELECT count(*) AS count
         FROM learner_facts
         WHERE period_key = ANY($1::text[])`,
        [[
          "icu-timezone-alias-period",
          "year-zero-period",
          "year-zero-cross-year-period",
        ]],
      )).rows[0].count), 0);
      const oldWriterSchedules = await upgrade.query(
        `SELECT period_key, due_at
         FROM story_collectible_schedules
         WHERE period_key = ANY($1::text[])
         ORDER BY period_key`,
        [[
          "lowercase-timezone-period",
          "icu-timezone-retry-period",
          "year-zero-period",
          "year-zero-cross-year-period",
        ]],
      );
      const retryExpectedDueAt = new Date((await upgrade.query(
        `SELECT '2026-09-05'::timestamp AT TIME ZONE $1 AS due_at`,
        [icuOnlyTimezone.canonical],
      )).rows[0].due_at).toISOString();
      assert.deepEqual(
        oldWriterSchedules.rows.map((row) => ({
          periodKey: row.period_key,
          dueAt: new Date(row.due_at).toISOString(),
        })),
        [
          {
            periodKey: "icu-timezone-retry-period",
            dueAt: retryExpectedDueAt,
          },
          {
            periodKey: "lowercase-timezone-period",
            dueAt: "2026-09-05T04:00:00.000Z",
          },
        ],
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
         WHERE period_key = 'current-period'
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

      const adjacentEventId = crypto.randomUUID();
      await upgrade.query(
        `INSERT INTO events (
           id, integration_id, learner_id, idempotency_key, event_type, occurred_at
         ) VALUES ($1, $2, $3, 'adjacent-weekend-event',
           'daily_log_week.configured', '2026-08-23T12:00:00Z')`,
        [adjacentEventId, integrationId, learnerId],
      );
      await upgrade.query(
        `INSERT INTO learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, 'daily_log_week.configured',
           'adjacent-weekend-fact', 'adjacent-weekend-period',
           '2026-08-23T12:00:00Z', $4, '2026-08-23T12:00:00Z')`,
        [integrationId, learnerId, adjacentEventId, {
          term_token: "terminal-weekend-term",
          term_start_day: "2026-05-11",
          term_end_day: "2026-08-30",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_index: 15,
          week_start_day: "2026-08-23",
        }],
      );

      const terminalEventId = crypto.randomUUID();
      await upgrade.query(
        `INSERT INTO events (
           id, integration_id, learner_id, idempotency_key, event_type, occurred_at
         ) VALUES ($1, $2, $3, 'terminal-weekend-event',
           'daily_log_week.configured', '2026-08-30T12:00:00Z')`,
        [terminalEventId, integrationId, learnerId],
      );
      await upgrade.query(
        `INSERT INTO learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, 'daily_log_week.configured',
           'terminal-weekend-fact', 'terminal-weekend-period',
           '2026-08-30T12:00:00Z', $4, '2026-08-30T12:00:00Z')`,
        [integrationId, learnerId, terminalEventId, {
          term_token: "terminal-weekend-term",
          term_start_day: "2026-05-11",
          term_end_day: "2026-08-30",
          term_timezone: "America/Toronto",
          term_week_count: 16,
          week_index: 16,
          week_start_day: "2026-08-30",
        }],
      );
      const beforeAlignment = await upgrade.query(
        `SELECT period_key, due_at, reconciled_at
         FROM story_collectible_schedules
         WHERE period_key = ANY($1::text[])
         ORDER BY period_key`,
        [["adjacent-weekend-period", "terminal-weekend-period"]],
      );
      assert.deepEqual(
        beforeAlignment.rows.map((row) => ({
          periodKey: row.period_key,
          dueAt: new Date(row.due_at).toISOString(),
          reconciledAt: row.reconciled_at,
        })),
        [
          {
            periodKey: "adjacent-weekend-period",
            dueAt: "2026-08-29T04:00:00.000Z",
            reconciledAt: null,
          },
          {
            periodKey: "terminal-weekend-period",
            dueAt: "2026-08-31T04:00:00.000Z",
            reconciledAt: null,
          },
        ],
      );

      const alignmentMigrationSql = await readFile(
        join(migrationsDirectory, "0008_align_short_story_weeks.sql"),
        "utf8",
      );
      const alignmentLockHolder = await upgrade.connect();
      const alignmentMigrationClient = await upgrade.connect();
      const alignmentObserver = await upgrade.connect();
      try {
        await alignmentLockHolder.query("BEGIN");
        await alignmentLockHolder.query(
          "LOCK TABLE story_collectible_schedules IN ROW EXCLUSIVE MODE",
        );
        const alignmentPid = Number(
          (await alignmentMigrationClient.query("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid,
        );
        const alignmentStartedAt = Date.now();
        const alignmentAttempt = alignmentMigrationClient
          .query(alignmentMigrationSql)
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          );
        await waitFor(async () => {
          const waiting = await alignmentObserver.query(
            `SELECT wait_event_type
             FROM pg_stat_activity
             WHERE pid = $1`,
            [alignmentPid],
          );
          return waiting.rows[0]?.wait_event_type === "Lock";
        });
        const alignmentResult = await alignmentAttempt;
        assert.equal(alignmentResult.ok, false);
        if (alignmentResult.ok) throw new Error("alignment migration unexpectedly succeeded");
        assert.ok(postgresViolation(alignmentResult.error, "55P03"));
        assert.ok(Date.now() - alignmentStartedAt < 5_000);
      } finally {
        await alignmentLockHolder.query("ROLLBACK").catch(() => undefined);
        alignmentLockHolder.release();
        alignmentMigrationClient.release();
        alignmentObserver.release();
      }

      await upgrade.query(alignmentMigrationSql);
      const afterAlignment = await upgrade.query(
        `SELECT period_key, due_at, reconciled_at
         FROM story_collectible_schedules
         WHERE period_key = ANY($1::text[])
         ORDER BY period_key`,
        [["adjacent-weekend-period", "terminal-weekend-period"]],
      );
      assert.deepEqual(
        afterAlignment.rows.map((row) => ({
          periodKey: row.period_key,
          dueAt: new Date(row.due_at).toISOString(),
          reconciledAt: row.reconciled_at,
        })),
        [
          {
            periodKey: "adjacent-weekend-period",
            dueAt: "2026-08-29T04:00:00.000Z",
            reconciledAt: null,
          },
          {
            periodKey: "terminal-weekend-period",
            dueAt: "2026-08-30T12:00:00.000Z",
            reconciledAt: null,
          },
        ],
      );

      const compatibleTerminalEventId = crypto.randomUUID();
      await upgrade.query(
        `INSERT INTO events (
           id, integration_id, learner_id, idempotency_key, event_type, occurred_at
         ) VALUES ($1, $2, $3, 'compatible-terminal-weekend-event',
           'daily_log_week.configured', '2026-08-30T12:00:00Z')`,
        [compatibleTerminalEventId, integrationId, learnerId],
      );
      await upgrade.query(
        `INSERT INTO learner_facts (
           integration_id, learner_id, source_event_id, event_type, semantic_key,
           period_key, occurred_at, metadata, created_at
         ) VALUES ($1, $2, $3, 'daily_log_week.configured',
           'compatible-terminal-weekend-fact', 'compatible-terminal-weekend-period',
           '2026-08-30T12:00:00Z', $4, '2026-08-30T12:00:00Z')`,
        [integrationId, learnerId, compatibleTerminalEventId, {
            term_token: "compatible-terminal-weekend-term",
            term_start_day: "2026-05-11",
            term_end_day: "2026-08-30",
            term_timezone: "America/Toronto",
            term_week_count: 16,
            week_index: 16,
            week_start_day: "2026-08-30",
          }],
      );
      const compatibleTerminalSchedule = await upgrade.query(
        `SELECT due_at, reconciled_at
         FROM story_collectible_schedules
         WHERE period_key = 'compatible-terminal-weekend-period'`,
      );
      assert.equal(compatibleTerminalSchedule.rowCount, 1);
      assert.equal(
        new Date(compatibleTerminalSchedule.rows[0].due_at).toISOString(),
        "2026-08-30T12:00:00.000Z",
      );
      assert.equal(compatibleTerminalSchedule.rows[0].reconciled_at, null);
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
