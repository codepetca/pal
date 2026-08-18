SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."is_late_terminal_story_configuration"(
	"calendar_metadata" jsonb,
	"configuration_created_at" timestamp with time zone
) RETURNS boolean AS $$
DECLARE
	"raw_week_start" date;
	"week_index_numeric" numeric;
	"term_week_count_numeric" numeric;
	"term_timezone_value" text;
BEGIN
	IF jsonb_typeof("calendar_metadata"->'week_index') IS DISTINCT FROM 'number'
		OR jsonb_typeof("calendar_metadata"->'term_week_count') IS DISTINCT FROM 'number'
		OR jsonb_typeof("calendar_metadata"->'week_start_day') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'term_timezone') IS DISTINCT FROM 'string'
		OR ("calendar_metadata"->>'week_start_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
	THEN
		RETURN false;
	END IF;

	"week_index_numeric" := ("calendar_metadata"->>'week_index')::numeric;
	"term_week_count_numeric" := ("calendar_metadata"->>'term_week_count')::numeric;
	"raw_week_start" := ("calendar_metadata"->>'week_start_day')::date;
	"term_timezone_value" := "calendar_metadata"->>'term_timezone';

	IF "week_index_numeric" <> trunc("week_index_numeric")
		OR "term_week_count_numeric" <> trunc("term_week_count_numeric")
		OR "week_index_numeric" <> "term_week_count_numeric"
		OR extract(isodow FROM "raw_week_start") <= 5
	THEN
		RETURN false;
	END IF;

	-- Keep the landed parameter name for CREATE OR REPLACE compatibility. New
	-- callers pass the producer occurred_at, never the receipt created_at.
	RETURN ("configuration_created_at" AT TIME ZONE "term_timezone_value")::date
		> "raw_week_start";
EXCEPTION
	WHEN invalid_text_representation
		OR datetime_field_overflow
		OR numeric_value_out_of_range
		OR invalid_parameter_value
	THEN
		RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enqueue_story_collectible_schedule"() RETURNS trigger AS $$
DECLARE
	"due_at_value" timestamp with time zone;
	"terminal_weekend_value" boolean;
	"terminal_open_at_value" timestamp with time zone;
	"effective_due_at_value" timestamp with time zone;
	"late_terminal_value" boolean;
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
	"terminal_open_at_value" := CASE
		WHEN "terminal_weekend_value" THEN
			(NEW."metadata"->>'week_start_day')::date::timestamp
				AT TIME ZONE (NEW."metadata"->>'term_timezone')
		ELSE NULL
	END;
	"effective_due_at_value" := CASE
		WHEN "terminal_weekend_value" THEN greatest(
			"due_at_value",
			NEW."occurred_at",
			"terminal_open_at_value"
		)
		ELSE "due_at_value"
	END;
	"late_terminal_value" := "public"."is_late_terminal_story_configuration"(
		NEW."metadata",
		NEW."occurred_at"
	);

	INSERT INTO "public"."story_collectible_schedules" (
		"learner_id", "period_key", "source_fact_id", "due_at", "reconciled_at", "created_at"
	) VALUES (
		NEW."learner_id",
		NEW."period_key",
		NEW."id",
		"effective_due_at_value",
		CASE
			WHEN "late_terminal_value"
				OR (NOT "terminal_weekend_value" AND "due_at_value" < NEW."occurred_at")
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
	"source_occurred_at" timestamp with time zone;
	"source_created_at" timestamp with time zone;
	"source_terminal_weekend" boolean;
	"source_terminal_open_at" timestamp with time zone;
	"source_late_terminal" boolean;
BEGIN
	IF TG_OP = 'INSERT' THEN
		SELECT
			"learner_facts"."learner_id",
			"learner_facts"."event_type",
			"learner_facts"."period_key",
			"learner_facts"."metadata",
			"public"."calculate_story_collectible_due_at"("learner_facts"."metadata"),
			"learner_facts"."occurred_at",
			"learner_facts"."created_at"
		INTO
			"source_learner_id", "source_event_type", "source_period_key",
			"source_metadata", "source_due_at", "source_occurred_at", "source_created_at"
		FROM "public"."learner_facts"
		WHERE "learner_facts"."id" = NEW."source_fact_id";

		IF NOT FOUND OR "source_learner_id" IS DISTINCT FROM NEW."learner_id" THEN
			RETURN NEW;
		END IF;

		"source_terminal_weekend" := coalesce(
			("source_metadata"->>'week_index')::numeric =
				("source_metadata"->>'term_week_count')::numeric
			AND extract(isodow FROM ("source_metadata"->>'week_start_day')::date) > 5,
			false
		);
		"source_terminal_open_at" := CASE
			WHEN "source_terminal_weekend" THEN
				("source_metadata"->>'week_start_day')::date::timestamp
					AT TIME ZONE ("source_metadata"->>'term_timezone')
			ELSE NULL
		END;
		"source_effective_due_at" := CASE
			WHEN "source_terminal_weekend" THEN greatest(
				"source_due_at", "source_occurred_at", "source_terminal_open_at"
			)
			ELSE "source_due_at"
		END;
		"source_late_terminal" := "public"."is_late_terminal_story_configuration"(
			"source_metadata", "source_occurred_at"
		);

		IF "source_event_type" IS DISTINCT FROM 'daily_log_week.configured'
			OR "source_period_key" IS DISTINCT FROM NEW."period_key"
			OR "source_effective_due_at" IS DISTINCT FROM NEW."due_at"
			OR "source_created_at" IS DISTINCT FROM NEW."created_at"
			OR NEW."reconciled_at" IS DISTINCT FROM (CASE
				WHEN "source_late_terminal"
					OR (NOT "source_terminal_weekend" AND "source_due_at" < "source_occurred_at")
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

	IF ROW(NEW."id", NEW."learner_id", NEW."period_key", NEW."source_fact_id", NEW."due_at", NEW."created_at")
		IS DISTINCT FROM ROW(OLD."id", OLD."learner_id", OLD."period_key", OLD."source_fact_id", OLD."due_at", OLD."created_at")
		OR (OLD."reconciled_at" IS NOT NULL AND NEW."reconciled_at" IS DISTINCT FROM OLD."reconciled_at")
	THEN
		RAISE EXCEPTION 'story collectible schedules are immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'story_collectible_schedules_immutable';
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
