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
CREATE INDEX "title_awards_current_idx" ON "title_awards" USING btree ("learner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
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
ORDER BY "learner_id", "earned_at", "created_at"
ON CONFLICT ("learner_id", "title_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "title_awards" (
	"learner_id",
	"title_id",
	"kind",
	"source_fact_id",
	"earned_at"
)
SELECT
	"economy"."learner_id",
	'level-leader',
	'behavior',
	"source_fact"."id",
	"source_fact"."occurred_at"
FROM "economy"
JOIN LATERAL (
	SELECT "learner_facts"."id", "learner_facts"."occurred_at"
	FROM "learner_facts"
	WHERE "learner_facts"."learner_id" = "economy"."learner_id"
	ORDER BY "learner_facts"."created_at" DESC
	LIMIT 1
) AS "source_fact" ON true
WHERE "economy"."level" >= 5
ON CONFLICT ("learner_id", "title_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "title_awards" (
	"learner_id",
	"title_id",
	"kind",
	"source_fact_id",
	"earned_at"
)
SELECT
	"economy"."learner_id",
	'rhythm-builder',
	'behavior',
	"source_fact"."id",
	"source_fact"."occurred_at"
FROM "economy"
JOIN LATERAL (
	SELECT "learner_facts"."id", "learner_facts"."occurred_at"
	FROM "learner_facts"
	WHERE "learner_facts"."learner_id" = "economy"."learner_id"
	ORDER BY "learner_facts"."created_at" DESC
	LIMIT 1
) AS "source_fact" ON true
WHERE "economy"."streak_current" >= 3
ON CONFLICT ("learner_id", "title_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "title_awards" (
	"learner_id",
	"title_id",
	"kind",
	"source_fact_id",
	"earned_at"
)
SELECT DISTINCT ON ("candidate"."learner_id", "candidate"."title_id")
	"candidate"."learner_id",
	"candidate"."title_id",
	'story',
	"candidate"."source_fact_id",
	"candidate"."earned_at"
FROM (
	SELECT
		"story_plan_chapters"."learner_id",
		CASE "story_plan_chapters"."chapter_id"
			WHEN 'egg-and-light' THEN 'gentle-keeper'
			WHEN 'long-night' THEN 'gentle-keeper'
			WHEN 'recipe-chosen' THEN 'brave-beginner'
			WHEN 'second-try' THEN 'try-again-chef'
			WHEN 'snacks-and-lumi' THEN 'true-friend'
			WHEN 'lumi-returns' THEN 'true-friend'
		END AS "title_id",
		"achievement_instances"."source_fact_id",
		"achievement_instances"."earned_at"
	FROM "story_plan_chapters"
	JOIN "achievement_instances"
		ON "achievement_instances"."learner_id" = "story_plan_chapters"."learner_id"
		AND "achievement_instances"."period_key" = "story_plan_chapters"."period_key"
		AND "achievement_instances"."achievement_key" = 'weekly-rhythm'
		AND "achievement_instances"."status" = 'earned'
	WHERE "story_plan_chapters"."chapter_id" IN (
		'egg-and-light',
		'long-night',
		'recipe-chosen',
		'second-try',
		'snacks-and-lumi',
		'lumi-returns'
	)
		AND "achievement_instances"."source_fact_id" IS NOT NULL
		AND "achievement_instances"."earned_at" IS NOT NULL
) AS "candidate"
ORDER BY
	"candidate"."learner_id",
	"candidate"."title_id",
	"candidate"."earned_at",
	"candidate"."source_fact_id"
ON CONFLICT ("learner_id", "title_id") DO NOTHING;
