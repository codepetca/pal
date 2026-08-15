import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
  throw new Error("Title upgrade verification may run only on local Postgres");
}

const databaseName = `pal_title_upgrade_${process.pid}_${Date.now()}`;
if (!/^pal_title_upgrade_[0-9]+_[0-9]+$/.test(databaseName)) {
  throw new Error("Unsafe temporary database name");
}
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`CREATE DATABASE "${databaseName}"`);

const testDatabase = new Client({ connectionString: testUrl.toString() });
try {
  await testDatabase.connect();
  for (const migration of [
    "0000_initial_schema.sql",
    "0001_economy_lifetime_streak.sql",
    "0002_woozy_stark_industries.sql",
    "0003_enforce_achievement_ownership.sql",
    "0004_anchor_achievement_periods.sql",
    "0005_sudden_black_cat.sql",
    "0006_add_story_plans.sql",
  ]) {
    await testDatabase.query(
      await readFile(join(migrationsDirectory, migration), "utf8"),
    );
  }

  await testDatabase.query("BEGIN");
  const integration = await testDatabase.query(`
    INSERT INTO integrations (slug, name, secret_hash)
    VALUES ('title-upgrade', 'Title Upgrade', 'title-upgrade-secret')
    RETURNING id
  `);
  const learner = await testDatabase.query(`
    INSERT INTO learners (integration_id, external_learner_id)
    VALUES ($1, 'opaque-title-upgrade-learner')
    RETURNING id
  `, [integration.rows[0].id]);
  const learnerId = learner.rows[0].id;
  const event = await testDatabase.query(`
    INSERT INTO events (
      integration_id,
      learner_id,
      idempotency_key,
      event_type,
      occurred_at
    ) VALUES ($1, $2, 'title-upgrade-event', 'daily_log.completed', '2026-08-31T15:00:00Z')
    RETURNING id
  `, [integration.rows[0].id, learnerId]);
  const fact = await testDatabase.query(`
    INSERT INTO learner_facts (
      integration_id,
      learner_id,
      source_event_id,
      event_type,
      semantic_key,
      period_key,
      occurred_at
    ) VALUES ($1, $2, $3, 'daily_log.completed', '2026-08-31', 'upgrade-week-1', '2026-08-31T15:00:00Z')
    RETURNING id
  `, [integration.rows[0].id, learnerId, event.rows[0].id]);
  const factId = fact.rows[0].id;
  const laterConfigEvent = await testDatabase.query(`
    INSERT INTO events (
      integration_id,
      learner_id,
      idempotency_key,
      event_type,
      occurred_at
    ) VALUES ($1, $2, 'title-upgrade-later-config', 'daily_log_week.configured', '2026-09-07T15:00:00Z')
    RETURNING id
  `, [integration.rows[0].id, learnerId]);
  const laterConfigFact = await testDatabase.query(`
    INSERT INTO learner_facts (
      integration_id,
      learner_id,
      source_event_id,
      event_type,
      semantic_key,
      period_key,
      occurred_at
    ) VALUES ($1, $2, $3, 'daily_log_week.configured', 'upgrade-config-v1', 'upgrade-week-2', '2026-09-07T15:00:00Z')
    RETURNING id
  `, [integration.rows[0].id, learnerId, laterConfigEvent.rows[0].id]);
  await testDatabase.query(`
    INSERT INTO achievement_periods (learner_id, period_key, anchor_at)
    VALUES ($1, 'upgrade-week-1', '2026-08-31T12:00:00Z')
  `, [learnerId]);
  await testDatabase.query(`
    INSERT INTO economy (
      learner_id,
      xp,
      xp_lifetime,
      level,
      streak_current,
      streak_last_day,
      last_event_at
    ) VALUES ($1, 0, 2000, 5, 3, '2026-08-31', '2026-08-31T15:00:00Z')
  `, [learnerId]);
  const plan = await testDatabase.query(`
    INSERT INTO story_plans (
      learner_id,
      term_key,
      story_id,
      story_version,
      total_periods
    ) VALUES ($1, 'upgrade-term', 'pips-first-recipe', 1, 6)
    RETURNING id
  `, [learnerId]);
  const chapterIds = [
    "egg-and-light",
    "pip-hatches",
    "recipe-chosen",
    "burnt-batch",
    "second-try",
    "snacks-and-lumi",
  ];
  for (const [index, chapterId] of chapterIds.entries()) {
    await testDatabase.query(`
      INSERT INTO story_plan_chapters (
        story_plan_id,
        learner_id,
        period_number,
        period_key,
        chapter_id
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      plan.rows[0].id,
      learnerId,
      index + 1,
      index === 0 ? "upgrade-week-1" : null,
      chapterId,
    ]);
  }
  await testDatabase.query(`
    INSERT INTO achievement_instances (
      learner_id,
      achievement_key,
      scope_key,
      period_key,
      status,
      earned_at,
      source_fact_id
    ) VALUES
      ($1, 'weekly-rhythm', 'upgrade-week-1', 'upgrade-week-1', 'earned', '2026-08-31T15:00:00Z', $2),
      ($1, 'on-time-finish', 'upgrade-item', 'upgrade-week-1', 'earned', '2026-08-30T15:00:00Z', $2)
  `, [learnerId, factId]);
  await testDatabase.query("COMMIT");

  await testDatabase.query(
    await readFile(
      join(migrationsDirectory, "0007_title_awards.sql"),
      "utf8",
    ),
  );

  const awards = await testDatabase.query(`
    SELECT title_id, kind, source_fact_id, earned_at
    FROM title_awards
    WHERE learner_id = $1
  `, [learnerId]);
  assert.deepEqual(
    new Set(awards.rows.map((award) => award.title_id)),
    new Set([
      "gentle-keeper",
      "level-leader",
      "on-time-pro",
      "rhythm-builder",
    ]),
  );
  assert.equal(
    awards.rows.find((award) => award.title_id === "gentle-keeper")?.kind,
    "story",
  );
  for (const titleId of ["level-leader", "rhythm-builder"]) {
    const migrated = awards.rows.find((award) => award.title_id === titleId);
    assert.equal(migrated?.source_fact_id, null);
    assert.equal(migrated?.earned_at, null);
    assert.notEqual(migrated?.source_fact_id, laterConfigFact.rows[0].id);
  }

  const current = await testDatabase.query(`
    SELECT title_id
    FROM title_awards
    WHERE learner_id = $1
    ORDER BY
      created_at DESC,
      CASE
        WHEN kind = 'story' THEN 100 + CASE title_id
          WHEN 'true-friend' THEN 40
          WHEN 'try-again-chef' THEN 30
          WHEN 'brave-beginner' THEN 20
          WHEN 'gentle-keeper' THEN 10
          ELSE 0
        END
        WHEN title_id = 'level-leader' THEN 30
        WHEN title_id = 'on-time-pro' THEN 20
        WHEN title_id = 'rhythm-builder' THEN 10
        ELSE 0
      END DESC,
      title_id DESC
    LIMIT 1
  `, [learnerId]);
  assert.equal(current.rows[0]?.title_id, "gentle-keeper");
  console.log("title award upgrade verified");
} finally {
  await testDatabase.end().catch(() => undefined);
  await admin.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1 AND pid <> pg_backend_pid()
  `, [databaseName]);
  await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
}
