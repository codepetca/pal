SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."calculate_story_collectible_due_at"("calendar_metadata" jsonb) RETURNS timestamp with time zone AS $$
DECLARE
	"term_start" date;
	"term_end" date;
	"raw_week_start" date;
	"week_start" date;
	"week_index_numeric" numeric;
	"week_index_value" integer;
	"term_week_count_numeric" numeric;
	"term_week_count_value" integer;
	"term_timezone_value" text;
	"resolved_timezone_value" text;
	"term_start_weekday" integer;
	"term_end_weekday" integer;
	"first_instructional_day" date;
	"first_instructional_weekday" integer;
	"first_normal_monday" date;
	"final_monday" date;
	"earliest_week_start" date;
	"latest_week_start" date;
	"weekday" integer;
	"friday" date;
	"due_day" date;
BEGIN
	IF jsonb_typeof("calendar_metadata"->'term_token') IS DISTINCT FROM 'string'
		OR length("calendar_metadata"->>'term_token') < 1
		OR length("calendar_metadata"->>'term_token') > 128
		OR ("calendar_metadata"->>'term_token') !~ '^[A-Za-z0-9._~-]+$'
		OR jsonb_typeof("calendar_metadata"->'term_start_day') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'term_end_day') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'term_timezone') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'week_index') IS DISTINCT FROM 'number'
		OR ("calendar_metadata"->>'term_start_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		OR ("calendar_metadata"->>'term_end_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
	THEN
		RETURN NULL;
	END IF;

	"term_start" := ("calendar_metadata"->>'term_start_day')::date;
	"term_end" := ("calendar_metadata"->>'term_end_day')::date;
	"week_index_numeric" := ("calendar_metadata"->>'week_index')::numeric;
	IF "week_index_numeric" <> trunc("week_index_numeric") THEN
		RETURN NULL;
	END IF;
	"week_index_value" := "week_index_numeric"::integer;
	"term_timezone_value" := "calendar_metadata"->>'term_timezone';
	SELECT "time_zone"."name"
	INTO "resolved_timezone_value"
	FROM "pg_catalog"."pg_timezone_names" AS "time_zone"
	WHERE "pg_catalog"."lower"("time_zone"."name") =
		"pg_catalog"."lower"("term_timezone_value")
	ORDER BY ("time_zone"."name" = "term_timezone_value") DESC,
		"time_zone"."name"
	LIMIT 1;

	IF ("calendar_metadata" ? 'term_week_count') <> ("calendar_metadata" ? 'week_start_day') THEN
		RETURN NULL;
	END IF;

	IF "calendar_metadata" ? 'term_week_count' THEN
		IF jsonb_typeof("calendar_metadata"->'term_week_count') IS DISTINCT FROM 'number'
			OR jsonb_typeof("calendar_metadata"->'week_start_day') IS DISTINCT FROM 'string'
			OR ("calendar_metadata"->>'week_start_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		THEN
			RETURN NULL;
		END IF;
		"term_week_count_numeric" := ("calendar_metadata"->>'term_week_count')::numeric;
		IF "term_week_count_numeric" <> trunc("term_week_count_numeric") THEN
			RETURN NULL;
		END IF;
		"term_week_count_value" := "term_week_count_numeric"::integer;
		"raw_week_start" := ("calendar_metadata"->>'week_start_day')::date;
		"week_start" := "raw_week_start";
	ELSE
		"term_week_count_value" := 16;
	END IF;

	IF "term_start" > "term_end"
		OR "term_week_count_value" < 6
		OR "term_week_count_value" > 24
		OR "week_index_value" < 1
		OR "week_index_value" > "term_week_count_value"
		OR "resolved_timezone_value" IS NULL THEN
		RETURN NULL;
	END IF;
	IF "raw_week_start" IS NOT NULL AND (
		"raw_week_start" < "term_start"
		OR "raw_week_start" > "term_end"
	) THEN
		RETURN NULL;
	END IF;

	-- Week 1 starts on the first Monday-Friday day on/after the term start and
	-- still ends Friday. Every later ordinal starts no earlier than the following
	-- Monday. The final ordinal may end midweek.
	-- This mirrors the ingest validator's Monday-Friday short-edge model while
	-- still allowing authoritative gaps for breaks.
	"term_start_weekday" := extract(isodow from "term_start")::integer;
	"term_end_weekday" := extract(isodow from "term_end")::integer;
	"first_instructional_day" := "term_start" + CASE
		WHEN "term_start_weekday" <= 5 THEN 0
		ELSE 8 - "term_start_weekday"
	END;
	"first_instructional_weekday" := extract(isodow from "first_instructional_day")::integer;
	"first_normal_monday" := "first_instructional_day" + (8 - "first_instructional_weekday");
	"final_monday" := "term_end" - ("term_end_weekday" - 1);
	"earliest_week_start" := CASE
		WHEN "week_index_value" = 1 THEN "first_instructional_day"
		ELSE "first_normal_monday" + (("week_index_value" - 2) * 7)
	END;
	"latest_week_start" := CASE
		WHEN "week_index_value" = 1
			THEN "final_monday" - (("term_week_count_value" - 2) * 7) - 3
		ELSE "final_monday" - (("term_week_count_value" - "week_index_value") * 7)
	END;
	"week_start" := coalesce(
		"week_start",
		CASE
			WHEN "week_index_value" = 1 THEN "first_instructional_day"
			ELSE "first_normal_monday" + (("week_index_value" - 2) * 7)
		END
	);
	"weekday" := extract(isodow from "week_start")::integer;
	IF "week_index_value" = "term_week_count_value" THEN
		"week_start" := "week_start" - ("weekday" - 1);
	ELSIF "weekday" > 5 THEN
		"week_start" := "week_start" + (8 - "weekday");
	ELSIF "week_index_value" > 1 THEN
		"week_start" := "week_start" - ("weekday" - 1);
	END IF;

	IF "week_start" < "earliest_week_start"
		OR "week_start" > "latest_week_start"
		OR "week_start" > "term_end" THEN
		RETURN NULL;
	END IF;

	"weekday" := extract(isodow from "week_start")::integer;
	"friday" := "week_start" + ((5 - "weekday" + 7) % 7);
	"due_day" := least("friday", "term_end") + 1;
	RETURN "due_day"::timestamp AT TIME ZONE "resolved_timezone_value";
EXCEPTION
	WHEN invalid_text_representation
		OR datetime_field_overflow
		OR numeric_value_out_of_range
	THEN
		RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enqueue_story_collectible_schedule"() RETURNS trigger AS $$
DECLARE
	"due_at_value" timestamp with time zone;
	"terminal_weekend_value" boolean;
	"effective_due_at_value" timestamp with time zone;
BEGIN
	IF NEW."event_type" <> 'daily_log_week.configured'
		OR NEW."period_key" IS NULL
		OR NOT (NEW."metadata" ?| ARRAY[
			'term_token',
			'term_start_day',
			'term_end_day',
			'term_timezone',
			'term_week_count',
			'week_start_day',
			'week_index'
		])
	THEN
		RETURN NEW;
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "public"."weekly_rhythm_configs" AS "weekly_config"
		WHERE "weekly_config"."learner_id" = NEW."learner_id"
			AND "weekly_config"."period_key" = NEW."period_key"
			AND "weekly_config"."period_status" = 'closed'
	) AND NOT EXISTS (
		SELECT 1
		FROM "public"."learner_facts" AS "calendar_fact"
		WHERE "calendar_fact"."learner_id" = NEW."learner_id"
			AND "calendar_fact"."period_key" = NEW."period_key"
			AND "calendar_fact"."event_type" = 'daily_log_week.configured'
			AND "calendar_fact"."metadata" ? 'week_index'
			AND "calendar_fact"."id" <> NEW."id"
	) THEN
		RAISE EXCEPTION 'closed calendar-less period cannot enroll in story scheduling'
			USING ERRCODE = '23514',
				CONSTRAINT = 'story_collectible_schedule_closed_calendarless';
	END IF;

	"due_at_value" := "public"."calculate_story_collectible_due_at"(NEW."metadata");
	IF "due_at_value" IS NULL THEN
		RAISE EXCEPTION 'weekly configuration fact has no valid story due boundary'
			USING ERRCODE = '23514',
				CONSTRAINT = 'story_collectible_schedule_calendar_valid';
	END IF;

	"terminal_weekend_value" := coalesce(
		(NEW."metadata"->>'week_index')::numeric =
			(NEW."metadata"->>'term_week_count')::numeric
		AND extract(isodow FROM (NEW."metadata"->>'week_start_day')::date) > 5,
		false
	);
	"effective_due_at_value" := CASE
		WHEN "terminal_weekend_value" AND "due_at_value" < NEW."created_at"
			THEN NEW."created_at"
		ELSE "due_at_value"
	END;

	INSERT INTO "public"."story_collectible_schedules" (
		"learner_id",
		"period_key",
		"source_fact_id",
		"due_at",
		"reconciled_at",
		"created_at"
	) VALUES (
		NEW."learner_id",
		NEW."period_key",
		NEW."id",
		"effective_due_at_value",
		CASE
			WHEN NOT "terminal_weekend_value" AND "due_at_value" < NEW."created_at"
				THEN NEW."created_at"
			ELSE NULL
		END,
		NEW."created_at"
	)
	ON CONFLICT ("learner_id", "period_key") DO NOTHING;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_story_collectible_schedule"() RETURNS trigger AS $$
DECLARE
	"source_learner_id" uuid;
	"source_event_type" text;
	"source_period_key" text;
	"source_metadata" jsonb;
	"source_due_at" timestamp with time zone;
	"source_effective_due_at" timestamp with time zone;
	"source_created_at" timestamp with time zone;
	"source_terminal_weekend" boolean;
BEGIN
	IF TG_OP = 'INSERT' THEN
		SELECT
			"learner_facts"."learner_id",
			"learner_facts"."event_type",
			"learner_facts"."period_key",
			"learner_facts"."metadata",
			"public"."calculate_story_collectible_due_at"("learner_facts"."metadata"),
			"learner_facts"."created_at"
		INTO
			"source_learner_id",
			"source_event_type",
			"source_period_key",
			"source_metadata",
			"source_due_at",
			"source_created_at"
		FROM "public"."learner_facts"
		WHERE "learner_facts"."id" = NEW."source_fact_id";

		-- Leave absent or cross-owner sources to the composite foreign key so
		-- callers retain the precise referential-integrity failure.
		IF NOT FOUND OR "source_learner_id" IS DISTINCT FROM NEW."learner_id" THEN
			RETURN NEW;
		END IF;

		"source_terminal_weekend" := coalesce(
			("source_metadata"->>'week_index')::numeric =
				("source_metadata"->>'term_week_count')::numeric
			AND extract(isodow FROM ("source_metadata"->>'week_start_day')::date) > 5,
			false
		);
		"source_effective_due_at" := CASE
			WHEN "source_terminal_weekend" AND "source_due_at" < "source_created_at"
				THEN "source_created_at"
			ELSE "source_due_at"
		END;

		IF "source_event_type" IS DISTINCT FROM 'daily_log_week.configured'
			OR "source_period_key" IS DISTINCT FROM NEW."period_key"
			OR "source_effective_due_at" IS DISTINCT FROM NEW."due_at"
			OR "source_created_at" IS DISTINCT FROM NEW."created_at"
			OR NEW."reconciled_at" IS DISTINCT FROM (CASE
				WHEN NOT "source_terminal_weekend"
					AND "source_due_at" < "source_created_at"
					THEN "source_created_at"
				ELSE NULL
			END)
		THEN
			RAISE EXCEPTION 'story schedule must match its configuration fact'
				USING ERRCODE = '23514',
					CONSTRAINT = 'story_collectible_schedules_source_valid';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF EXISTS (SELECT 1 FROM "public"."learners" WHERE "id" = OLD."learner_id") THEN
			RAISE EXCEPTION 'story collectible schedules are immutable'
				USING ERRCODE = '23514',
					CONSTRAINT = 'story_collectible_schedules_immutable';
		END IF;
		RETURN OLD;
	END IF;

	IF ROW(
		NEW."id",
		NEW."learner_id",
		NEW."period_key",
		NEW."source_fact_id",
		NEW."due_at",
		NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id",
		OLD."learner_id",
		OLD."period_key",
		OLD."source_fact_id",
		OLD."due_at",
		OLD."created_at"
	) OR (
		OLD."reconciled_at" IS NOT NULL
		AND NEW."reconciled_at" IS DISTINCT FROM OLD."reconciled_at"
	) THEN
		RAISE EXCEPTION 'story collectible schedules are immutable'
			USING ERRCODE = '23514',
				CONSTRAINT = 'story_collectible_schedules_immutable';
	END IF;

	IF OLD."reconciled_at" IS NULL AND NEW."reconciled_at" IS NOT NULL AND NOT EXISTS (
		SELECT 1
		FROM "public"."story_plan_chapters"
		INNER JOIN "public"."learner_reward_grants"
			ON "learner_reward_grants"."story_plan_chapter_id" = "story_plan_chapters"."id"
			AND "learner_reward_grants"."kind" = 'story_chapter'
		WHERE "story_plan_chapters"."learner_id" = NEW."learner_id"
			AND "story_plan_chapters"."period_key" = NEW."period_key"
	) THEN
		RAISE EXCEPTION 'story schedule cannot reconcile before ownership exists'
			USING ERRCODE = '23514',
				CONSTRAINT = 'story_collectible_schedules_reconciliation_requires_grant';
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER "story_collectible_schedules_protect"
ON "public"."story_collectible_schedules";
--> statement-breakpoint
WITH "pending_source" AS MATERIALIZED (
	SELECT
		"schedule"."id",
		"schedule"."created_at",
		"public"."calculate_story_collectible_due_at"("fact"."metadata") AS "normalized_due_at"
	FROM "public"."story_collectible_schedules" AS "schedule"
	INNER JOIN "public"."learner_facts" AS "fact"
		ON "fact"."id" = "schedule"."source_fact_id"
		AND "fact"."learner_id" = "schedule"."learner_id"
	WHERE "schedule"."reconciled_at" IS NULL
)
UPDATE "public"."story_collectible_schedules" AS "schedule"
SET "due_at" = greatest(
	"pending_source"."normalized_due_at",
	"pending_source"."created_at"
)
FROM "pending_source"
WHERE "schedule"."id" = "pending_source"."id"
	-- Rows accepted by 0007 but invalid under the aligned calendar keep their
	-- existing boundary. This avoids collapsing adjacent legacy weeks together.
	AND "pending_source"."normalized_due_at" IS NOT NULL
	AND "schedule"."due_at" IS DISTINCT FROM greatest(
		"pending_source"."normalized_due_at",
		"pending_source"."created_at"
	);
--> statement-breakpoint
CREATE TRIGGER "story_collectible_schedules_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."story_collectible_schedules"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_story_collectible_schedule"();
