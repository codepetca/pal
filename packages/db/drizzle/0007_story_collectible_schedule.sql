CREATE TABLE "story_collectible_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"source_fact_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_collectible_schedules_learner_period_uq" UNIQUE("learner_id","period_key"),
	CONSTRAINT "story_collectible_schedules_source_fact_uq" UNIQUE("source_fact_id"),
	CONSTRAINT "story_collectible_schedules_period_nonempty" CHECK (length(btrim("story_collectible_schedules"."period_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "story_collectible_schedules" ADD CONSTRAINT "story_collectible_schedules_source_owner_fk" FOREIGN KEY ("source_fact_id","learner_id") REFERENCES "public"."learner_facts"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_collectible_schedules_pending_due_idx" ON "story_collectible_schedules" USING btree ("due_at","id","created_at","learner_id","period_key") WHERE "story_collectible_schedules"."reconciled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "story_collectible_schedules_pending_learner_idx" ON "story_collectible_schedules" USING btree ("learner_id","due_at","created_at","period_key") WHERE "story_collectible_schedules"."reconciled_at" IS NULL;
--> statement-breakpoint
CREATE FUNCTION "calculate_story_collectible_due_at"("calendar_metadata" jsonb) RETURNS timestamp with time zone AS $$
DECLARE
	"term_start" date;
	"term_end" date;
	"week_start" date;
	"week_index_value" integer;
	"term_timezone_value" text;
	"weekday" integer;
	"friday" date;
	"due_day" date;
BEGIN
	IF jsonb_typeof("calendar_metadata"->'term_start_day') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'term_end_day') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'term_timezone') IS DISTINCT FROM 'string'
		OR jsonb_typeof("calendar_metadata"->'week_index') IS DISTINCT FROM 'number'
		OR ("calendar_metadata"->>'term_start_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		OR ("calendar_metadata"->>'term_end_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		OR ("calendar_metadata"->>'week_index') !~ '^[0-9]{1,2}$'
	THEN
		RETURN NULL;
	END IF;

	"term_start" := ("calendar_metadata"->>'term_start_day')::date;
	"term_end" := ("calendar_metadata"->>'term_end_day')::date;
	"week_index_value" := ("calendar_metadata"->>'week_index')::integer;
	"term_timezone_value" := "calendar_metadata"->>'term_timezone';

	IF "term_start" > "term_end" OR "week_index_value" < 1 OR NOT EXISTS (
		SELECT 1 FROM pg_timezone_names
		WHERE name = "term_timezone_value"
	) THEN
		RETURN NULL;
	END IF;

	IF "calendar_metadata" ? 'week_start_day' THEN
		IF jsonb_typeof("calendar_metadata"->'week_start_day') IS DISTINCT FROM 'string'
			OR ("calendar_metadata"->>'week_start_day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		THEN
			RETURN NULL;
		END IF;
		"week_start" := ("calendar_metadata"->>'week_start_day')::date;
	ELSE
		"week_start" := "term_start" + (("week_index_value" - 1) * 7);
	END IF;

	IF "week_start" < "term_start" OR "week_start" > "term_end" THEN
		RETURN NULL;
	END IF;

	"weekday" := extract(isodow from "week_start")::integer;
	"friday" := "week_start" + ((5 - "weekday" + 7) % 7);
	"due_day" := least("friday", "term_end") + 1;
	RETURN "due_day"::timestamp AT TIME ZONE "term_timezone_value";
EXCEPTION
	WHEN invalid_text_representation
		OR datetime_field_overflow
		OR numeric_value_out_of_range
	THEN
		RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;
--> statement-breakpoint
CREATE FUNCTION "enqueue_story_collectible_schedule"() RETURNS trigger AS $$
DECLARE
	"due_at_value" timestamp with time zone;
BEGIN
	IF NEW."event_type" <> 'daily_log_week.configured'
		OR NEW."period_key" IS NULL
		OR NOT (NEW."metadata" ?& ARRAY[
			'term_start_day',
			'term_end_day',
			'term_timezone',
			'week_index'
		])
	THEN
		RETURN NEW;
	END IF;

	"due_at_value" := "calculate_story_collectible_due_at"(NEW."metadata");
	IF "due_at_value" IS NULL THEN
		RAISE EXCEPTION 'weekly configuration fact has no valid story due boundary'
			USING ERRCODE = '23514',
				CONSTRAINT = 'story_collectible_schedule_calendar_valid';
	END IF;

	INSERT INTO "story_collectible_schedules" (
		"learner_id",
		"period_key",
		"source_fact_id",
		"due_at",
		"created_at"
	) VALUES (
		NEW."learner_id",
		NEW."period_key",
		NEW."id",
		"due_at_value",
		NEW."created_at"
	)
	ON CONFLICT ("learner_id", "period_key") DO NOTHING;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "learner_facts_enqueue_story_collectible_schedule"
AFTER INSERT ON "learner_facts"
FOR EACH ROW EXECUTE FUNCTION "enqueue_story_collectible_schedule"();
CREATE FUNCTION "protect_story_collectible_schedule"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF EXISTS (SELECT 1 FROM "learners" WHERE "id" = OLD."learner_id") THEN
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
		FROM "story_plan_chapters"
		INNER JOIN "learner_reward_grants"
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
CREATE TRIGGER "story_collectible_schedules_protect"
BEFORE UPDATE OR DELETE ON "story_collectible_schedules"
FOR EACH ROW EXECUTE FUNCTION "protect_story_collectible_schedule"();
