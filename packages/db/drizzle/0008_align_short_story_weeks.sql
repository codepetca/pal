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
	IF "weekday" > 5 THEN
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
DROP TRIGGER "story_collectible_schedules_protect"
ON "public"."story_collectible_schedules";
--> statement-breakpoint
WITH "pending_source" AS MATERIALIZED (
	SELECT
		"schedule"."id",
		"fact"."metadata",
		"public"."calculate_story_collectible_due_at"("fact"."metadata") AS "normalized_due_at",
		("fact"."metadata"->>'term_start_day')::date AS "term_start",
		("fact"."metadata"->>'term_end_day')::date AS "term_end",
		("fact"."metadata"->>'week_start_day')::date AS "raw_week_start",
		("fact"."metadata"->>'week_index')::numeric::integer AS "week_index",
		("fact"."metadata"->>'term_week_count')::numeric::integer AS "term_week_count"
	FROM "public"."story_collectible_schedules" AS "schedule"
	INNER JOIN "public"."learner_facts" AS "fact"
		ON "fact"."id" = "schedule"."source_fact_id"
		AND "fact"."learner_id" = "schedule"."learner_id"
	WHERE "schedule"."reconciled_at" IS NULL
),
"corrected_due" AS MATERIALIZED (
	SELECT
		"pending_source"."id",
		coalesce(
			"pending_source"."normalized_due_at",
			CASE
				-- Migration 0007 accepted a terminal Saturday/Sunday marker and
				-- kept its schedule pending. Grandfather that already-enrolled
				-- week onto the preceding instructional Monday; new facts reject
				-- the same marker because no instructional day remains in term.
				WHEN "pending_source"."raw_week_start" BETWEEN
						"pending_source"."term_start" AND "pending_source"."term_end"
					AND "pending_source"."week_index" = "pending_source"."term_week_count"
					AND extract(isodow FROM "pending_source"."raw_week_start") > 5
				THEN "public"."calculate_story_collectible_due_at"(
					jsonb_set(
						"pending_source"."metadata",
						'{week_start_day}',
						to_jsonb((
							"pending_source"."raw_week_start" -
							(extract(isodow FROM "pending_source"."raw_week_start")::integer - 1)
						)::text)
					)
				)
			END
		) AS "due_at"
	FROM "pending_source"
)
UPDATE "public"."story_collectible_schedules" AS "schedule"
SET "due_at" = "corrected_due"."due_at"
FROM "corrected_due"
WHERE "schedule"."id" = "corrected_due"."id"
	AND "corrected_due"."due_at" IS NOT NULL
	AND "schedule"."due_at" IS DISTINCT FROM "corrected_due"."due_at";
--> statement-breakpoint
CREATE TRIGGER "story_collectible_schedules_protect"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."story_collectible_schedules"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_story_collectible_schedule"();
