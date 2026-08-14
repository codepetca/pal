CREATE TABLE "story_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"term_key" text NOT NULL,
	"story_id" text NOT NULL,
	"story_version" integer NOT NULL,
	"total_periods" integer NOT NULL,
	"chapter_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_plans_learner_term_uq" UNIQUE("learner_id","term_key"),
	CONSTRAINT "story_plans_version_positive" CHECK ("story_plans"."story_version" >= 1),
	CONSTRAINT "story_plans_period_count_range" CHECK ("story_plans"."total_periods" >= 6 AND "story_plans"."total_periods" <= 24),
	CONSTRAINT "story_plans_chapter_count_matches" CHECK (cardinality("story_plans"."chapter_ids") = "story_plans"."total_periods")
);
--> statement-breakpoint
ALTER TABLE "story_plans" ADD CONSTRAINT "story_plans_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;