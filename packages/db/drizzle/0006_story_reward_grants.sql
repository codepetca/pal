CREATE TABLE "learner_reward_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_order" bigint GENERATED ALWAYS AS IDENTITY (sequence name "learner_reward_grants_grant_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"learner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_fact_id" uuid NOT NULL,
	"story_plan_id" uuid,
	"story_plan_chapter_id" uuid,
	"behavior_title_id" text,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_reward_grants_order_uq" UNIQUE("grant_order"),
	CONSTRAINT "learner_reward_grants_kind_payload" CHECK ((
        "learner_reward_grants"."kind" = 'story_chapter'
        AND "learner_reward_grants"."story_plan_id" IS NOT NULL
        AND "learner_reward_grants"."story_plan_chapter_id" IS NOT NULL
        AND "learner_reward_grants"."behavior_title_id" IS NULL
      ) OR (
        "learner_reward_grants"."kind" = 'behavior_title'
        AND "learner_reward_grants"."story_plan_id" IS NULL
        AND "learner_reward_grants"."story_plan_chapter_id" IS NULL
        AND length(btrim("learner_reward_grants"."behavior_title_id")) > 0
      ))
);
--> statement-breakpoint
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
	CONSTRAINT "story_plan_chapters_id_plan_learner_uq" UNIQUE("id","story_plan_id","learner_id"),
	CONSTRAINT "story_plan_chapters_period_number_range" CHECK ("story_plan_chapters"."period_number" >= 1 AND "story_plan_chapters"."period_number" <= 24),
	CONSTRAINT "story_plan_chapters_chapter_id_nonempty" CHECK (length("story_plan_chapters"."chapter_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "story_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	"term_start_day" date NOT NULL,
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
ALTER TABLE "learner_reward_grants" ADD CONSTRAINT "learner_reward_grants_source_owner_fk" FOREIGN KEY ("source_fact_id","learner_id") REFERENCES "public"."learner_facts"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_reward_grants" ADD CONSTRAINT "learner_reward_grants_plan_owner_fk" FOREIGN KEY ("story_plan_id","learner_id") REFERENCES "public"."story_plans"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_reward_grants" ADD CONSTRAINT "learner_reward_grants_chapter_owner_fk" FOREIGN KEY ("story_plan_chapter_id","story_plan_id","learner_id") REFERENCES "public"."story_plan_chapters"("id","story_plan_id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plan_chapters" ADD CONSTRAINT "story_plan_chapters_plan_owner_fk" FOREIGN KEY ("story_plan_id","learner_id") REFERENCES "public"."story_plans"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plan_chapters" ADD CONSTRAINT "story_plan_chapters_period_owner_fk" FOREIGN KEY ("learner_id","period_key") REFERENCES "public"."achievement_periods"("learner_id","period_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plans" ADD CONSTRAINT "story_plans_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learner_reward_grants_story_slot_uq" ON "learner_reward_grants" USING btree ("story_plan_chapter_id") WHERE "learner_reward_grants"."kind" = 'story_chapter';--> statement-breakpoint
CREATE UNIQUE INDEX "learner_reward_grants_story_source_uq" ON "learner_reward_grants" USING btree ("learner_id","source_fact_id") WHERE "learner_reward_grants"."kind" = 'story_chapter';--> statement-breakpoint
CREATE UNIQUE INDEX "learner_reward_grants_behavior_title_uq" ON "learner_reward_grants" USING btree ("learner_id","behavior_title_id") WHERE "learner_reward_grants"."kind" = 'behavior_title';--> statement-breakpoint
CREATE INDEX "learner_reward_grants_projection_idx" ON "learner_reward_grants" USING btree ("learner_id","grant_order" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "learner_reward_grants_unseen_idx" ON "learner_reward_grants" USING btree ("learner_id","seen_at");
--> statement-breakpoint
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
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "check_story_plan_from_plan"() RETURNS trigger AS $$
BEGIN
	PERFORM "assert_story_plan_complete"(NEW."id");
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "check_story_plan_from_chapter"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		PERFORM "assert_story_plan_complete"(NEW."story_plan_id");
	ELSE
		PERFORM "assert_story_plan_complete"(OLD."story_plan_id");
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_story_plan_identity"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF EXISTS (SELECT 1 FROM "learners" WHERE "id" = OLD."learner_id") THEN
			RAISE EXCEPTION 'assigned story plans are immutable'
				USING ERRCODE = '23514', CONSTRAINT = 'story_plans_immutable';
		END IF;
		RETURN OLD;
	END IF;

	IF ROW(
		NEW."learner_id",
		NEW."term_key",
		NEW."term_start_day",
		NEW."story_id",
		NEW."story_version",
		NEW."total_periods"
	) IS DISTINCT FROM ROW(
		OLD."learner_id",
		OLD."term_key",
		OLD."term_start_day",
		OLD."story_id",
		OLD."story_version",
		OLD."total_periods"
	) THEN
		RAISE EXCEPTION 'story plan identity is immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'story_plans_immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_story_plan_chapter_assignment"() RETURNS trigger AS $$
BEGIN
	IF ROW(
		NEW."story_plan_id",
		NEW."learner_id",
		NEW."period_number",
		NEW."chapter_id"
	) IS DISTINCT FROM ROW(
		OLD."story_plan_id",
		OLD."learner_id",
		OLD."period_number",
		OLD."chapter_id"
	) OR (
		OLD."period_key" IS NOT NULL
		AND NEW."period_key" IS DISTINCT FROM OLD."period_key"
	) THEN
		RAISE EXCEPTION 'story plan chapter assignment is immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'story_plan_chapters_immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_learner_reward_grant"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF EXISTS (SELECT 1 FROM "learners" WHERE "id" = OLD."learner_id") THEN
			RAISE EXCEPTION 'learner reward grants are append-only'
				USING ERRCODE = '23514', CONSTRAINT = 'learner_reward_grants_append_only';
		END IF;
		RETURN OLD;
	END IF;

	IF ROW(
		NEW."id",
		NEW."grant_order",
		NEW."learner_id",
		NEW."kind",
		NEW."source_fact_id",
		NEW."story_plan_id",
		NEW."story_plan_chapter_id",
		NEW."behavior_title_id",
		NEW."created_at"
	) IS DISTINCT FROM ROW(
		OLD."id",
		OLD."grant_order",
		OLD."learner_id",
		OLD."kind",
		OLD."source_fact_id",
		OLD."story_plan_id",
		OLD."story_plan_chapter_id",
		OLD."behavior_title_id",
		OLD."created_at"
	) THEN
		RAISE EXCEPTION 'learner reward grant ownership is immutable'
			USING ERRCODE = '23514', CONSTRAINT = 'learner_reward_grants_append_only';
	END IF;
	IF OLD."seen_at" IS NOT NULL AND NEW."seen_at" IS DISTINCT FROM OLD."seen_at" THEN
		RAISE EXCEPTION 'learner reward grant acknowledgement is monotonic'
			USING ERRCODE = '23514', CONSTRAINT = 'learner_reward_grants_append_only';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "story_plans_immutable_before_update"
BEFORE UPDATE OR DELETE ON "story_plans"
FOR EACH ROW EXECUTE FUNCTION "protect_story_plan_identity"();
--> statement-breakpoint
CREATE TRIGGER "story_plan_chapters_immutable_before_update"
BEFORE UPDATE ON "story_plan_chapters"
FOR EACH ROW EXECUTE FUNCTION "protect_story_plan_chapter_assignment"();
--> statement-breakpoint
CREATE TRIGGER "learner_reward_grants_append_only_before_write"
BEFORE UPDATE OR DELETE ON "learner_reward_grants"
FOR EACH ROW EXECUTE FUNCTION "protect_learner_reward_grant"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "story_plans_complete_after_write"
AFTER INSERT OR UPDATE ON "story_plans"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_story_plan_from_plan"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "story_plan_chapters_complete_after_write"
AFTER INSERT OR UPDATE OR DELETE ON "story_plan_chapters"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_story_plan_from_chapter"();
