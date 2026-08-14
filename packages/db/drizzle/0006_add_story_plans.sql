CREATE TABLE "story_plan_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_plan_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"period_key" text,
	"chapter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_plan_chapters_plan_period_number_uq" UNIQUE("story_plan_id","period_number"),
	CONSTRAINT "story_plan_chapters_plan_period_key_uq" UNIQUE("story_plan_id","period_key"),
	CONSTRAINT "story_plan_chapters_plan_chapter_uq" UNIQUE("story_plan_id","chapter_id"),
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
	CONSTRAINT "story_plans_version_positive" CHECK ("story_plans"."story_version" >= 1),
	CONSTRAINT "story_plans_period_count_range" CHECK ("story_plans"."total_periods" >= 6 AND "story_plans"."total_periods" <= 24)
);
--> statement-breakpoint
ALTER TABLE "story_plan_chapters" ADD CONSTRAINT "story_plan_chapters_story_plan_id_story_plans_id_fk" FOREIGN KEY ("story_plan_id") REFERENCES "public"."story_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_plans" ADD CONSTRAINT "story_plans_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;