CREATE TABLE "title_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"title_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_fact_id" uuid NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "title_awards_learner_title_uq" UNIQUE("learner_id","title_id"),
	CONSTRAINT "title_awards_title_nonempty" CHECK (length(btrim("title_awards"."title_id")) > 0),
	CONSTRAINT "title_awards_kind_valid" CHECK ("title_awards"."kind" IN ('behavior', 'story'))
);
--> statement-breakpoint
ALTER TABLE "title_awards" ADD CONSTRAINT "title_awards_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_awards" ADD CONSTRAINT "title_awards_source_owner_fk" FOREIGN KEY ("source_fact_id","learner_id") REFERENCES "public"."learner_facts"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "title_awards_current_idx" ON "title_awards" USING btree ("learner_id","earned_at" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "title_awards" (
	"learner_id",
	"title_id",
	"kind",
	"source_fact_id",
	"earned_at"
)
SELECT DISTINCT ON ("learner_id")
	"learner_id",
	'on-time-pro',
	'behavior',
	"source_fact_id",
	"earned_at"
FROM "achievement_instances"
WHERE "achievement_key" = 'on-time-finish'
	AND "status" = 'earned'
	AND "source_fact_id" IS NOT NULL
	AND "earned_at" IS NOT NULL
ORDER BY "learner_id", "earned_at", "created_at";
