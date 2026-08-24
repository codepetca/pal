SET LOCAL lock_timeout = '2s';
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

	-- New application writers pin the immutable plan before inserting this fact.
	-- A term may continue after its story ends, so a known plan without this
	-- chapter must not enter the story scheduler. Keep the old behavior when no
	-- plan exists yet so an older writer remains safe during a rolling deploy.
	-- Later chapters on older, longer pinned plans continue to schedule.
	IF EXISTS (
		SELECT 1
		FROM "public"."story_plans" AS "story_plan"
		WHERE "story_plan"."learner_id" = NEW."learner_id"
			AND "story_plan"."term_key" = NEW."metadata"->>'term_token'
	) AND NOT EXISTS (
		SELECT 1
		FROM "public"."story_plans" AS "story_plan"
		INNER JOIN "public"."story_plan_chapters" AS "story_chapter"
			ON "story_chapter"."story_plan_id" = "story_plan"."id"
			AND "story_chapter"."learner_id" = "story_plan"."learner_id"
		WHERE "story_plan"."learner_id" = NEW."learner_id"
			AND "story_plan"."term_key" = NEW."metadata"->>'term_token'
			AND "story_chapter"."period_number" = (NEW."metadata"->>'week_index')::numeric
	) THEN
		RETURN NEW;
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
