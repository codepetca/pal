CREATE TABLE "story_plan_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_plan_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"period_key" text,
	"chapter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_plan_chapters_plan_period_number_uq" UNIQUE("story_plan_id","period_number"),
	CONSTRAINT "story_plan_chapters_plan_period_key_uq" UNIQUE("story_plan_id","period_key"),
	CONSTRAINT "story_plan_chapters_plan_chapter_uq" UNIQUE("story_plan_id","chapter_id"),
	CONSTRAINT "story_plan_chapters_learner_period_uq" UNIQUE("learner_id","period_key"),
	CONSTRAINT "story_plan_chapters_period_number_range" CHECK ("story_plan_chapters"."period_number" >= 1 AND "story_plan_chapters"."period_number" <= 24),
	CONSTRAINT "story_plan_chapters_chapter_id_nonempty" CHECK (length("story_plan_chapters"."chapter_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "story_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	"story_id" text NOT NULL,
	"story_version" integer NOT NULL,
	"total_periods" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_plans_learner_term_uq" UNIQUE("learner_id","term_key"),
	CONSTRAINT "story_plans_id_learner_uq" UNIQUE("id","learner_id"),
	CONSTRAINT "story_plans_version_positive" CHECK ("story_plans"."story_version" >= 1),
	CONSTRAINT "story_plans_period_count_range" CHECK ("story_plans"."total_periods" >= 6 AND "story_plans"."total_periods" <= 24)
);
--> statement-breakpoint
ALTER TABLE "story_plan_chapters" ADD CONSTRAINT "story_plan_chapters_plan_owner_fk" FOREIGN KEY ("story_plan_id","learner_id") REFERENCES "public"."story_plans"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plan_chapters" ADD CONSTRAINT "story_plan_chapters_period_owner_fk" FOREIGN KEY ("learner_id","period_key") REFERENCES "public"."achievement_periods"("learner_id","period_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plans" ADD CONSTRAINT "story_plans_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "assert_story_plan_complete"("target_plan_id" uuid) RETURNS void AS $$
DECLARE
	"expected_count" integer;
	"actual_count" integer;
	"first_period" integer;
	"last_period" integer;
BEGIN
	SELECT "total_periods"
	INTO "expected_count"
	FROM "story_plans"
	WHERE "id" = "target_plan_id";

	IF NOT FOUND THEN
		RETURN;
	END IF;

	SELECT count(*)::integer, coalesce(min("period_number"), 0), coalesce(max("period_number"), 0)
	INTO "actual_count", "first_period", "last_period"
	FROM "story_plan_chapters"
	WHERE "story_plan_id" = "target_plan_id";

	IF "actual_count" <> "expected_count"
		OR "first_period" <> 1
		OR "last_period" <> "expected_count" THEN
		RAISE EXCEPTION 'story plan % must contain exactly periods 1 through %', "target_plan_id", "expected_count"
			USING ERRCODE = '23514', CONSTRAINT = 'story_plan_chapters_complete';
	END IF;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION "check_story_plan_from_plan"() RETURNS trigger AS $$
BEGIN
	PERFORM "assert_story_plan_complete"(NEW."id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION "check_story_plan_from_chapter"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM "assert_story_plan_complete"(NEW."story_plan_id");
	ELSIF TG_OP = 'DELETE' THEN
		PERFORM "assert_story_plan_complete"(OLD."story_plan_id");
	ELSE
		PERFORM "assert_story_plan_complete"(OLD."story_plan_id");
		IF NEW."story_plan_id" <> OLD."story_plan_id" THEN
			PERFORM "assert_story_plan_complete"(NEW."story_plan_id");
		END IF;
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "story_plans_complete_after_write"
AFTER INSERT OR UPDATE ON "story_plans"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_story_plan_from_plan"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "story_plan_chapters_complete_after_write"
AFTER INSERT OR UPDATE OR DELETE ON "story_plan_chapters"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_story_plan_from_chapter"();
