CREATE TABLE "achievement_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"achievement_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"period_key" text,
	"status" text NOT NULL,
	"progress_current" integer,
	"progress_target" integer,
	"earned_at" timestamp with time zone,
	"source_fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_instances_scope_uq" UNIQUE("learner_id","achievement_key","scope_key"),
	CONSTRAINT "achievement_instances_status_valid" CHECK ("achievement_instances"."status" IN ('earned', 'in-progress', 'incomplete')),
	CONSTRAINT "achievement_instances_progress_non_negative" CHECK ("achievement_instances"."progress_current" IS NULL OR "achievement_instances"."progress_current" >= 0),
	CONSTRAINT "achievement_instances_target_positive" CHECK ("achievement_instances"."progress_target" IS NULL OR "achievement_instances"."progress_target" >= 1)
);
--> statement-breakpoint
CREATE TABLE "achievement_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_periods_learner_period_uq" UNIQUE("learner_id","period_key"),
	CONSTRAINT "achievement_periods_learner_ordinal_uq" UNIQUE("learner_id","ordinal"),
	CONSTRAINT "achievement_periods_ordinal_positive" CHECK ("achievement_periods"."ordinal" >= 1)
);
--> statement-breakpoint
CREATE TABLE "learner_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"semantic_key" text NOT NULL,
	"period_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_facts_semantic_uq" UNIQUE("learner_id","event_type","semantic_key")
);
--> statement-breakpoint
CREATE TABLE "reward_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"achievement_instance_id" uuid NOT NULL,
	"reward_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"icon" text,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_notices_achievement_uq" UNIQUE("achievement_instance_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_rhythm_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"config_version" integer NOT NULL,
	"period_status" text NOT NULL,
	"eligible_days" integer NOT NULL,
	"target_days" integer NOT NULL,
	"reconciliation_required" boolean DEFAULT false NOT NULL,
	"configured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_rhythm_configs_learner_period_uq" UNIQUE("learner_id","period_key"),
	CONSTRAINT "weekly_rhythm_configs_version_positive" CHECK ("weekly_rhythm_configs"."config_version" >= 1),
	CONSTRAINT "weekly_rhythm_configs_eligible_days_range" CHECK ("weekly_rhythm_configs"."eligible_days" >= 0 AND "weekly_rhythm_configs"."eligible_days" <= 5),
	CONSTRAINT "weekly_rhythm_configs_target_days_range" CHECK ("weekly_rhythm_configs"."target_days" >= 0 AND "weekly_rhythm_configs"."target_days" <= 4),
	CONSTRAINT "weekly_rhythm_configs_status_valid" CHECK ("weekly_rhythm_configs"."period_status" IN ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "achievement_instances" ADD CONSTRAINT "achievement_instances_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_instances" ADD CONSTRAINT "achievement_instances_source_fact_id_learner_facts_id_fk" FOREIGN KEY ("source_fact_id") REFERENCES "public"."learner_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_periods" ADD CONSTRAINT "achievement_periods_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_source_event_id_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_notices" ADD CONSTRAINT "reward_notices_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_notices" ADD CONSTRAINT "reward_notices_achievement_instance_id_achievement_instances_id_fk" FOREIGN KEY ("achievement_instance_id") REFERENCES "public"."achievement_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_rhythm_configs" ADD CONSTRAINT "weekly_rhythm_configs_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievement_instances_period_idx" ON "achievement_instances" USING btree ("learner_id","period_key");--> statement-breakpoint
CREATE INDEX "learner_facts_period_idx" ON "learner_facts" USING btree ("learner_id","period_key");--> statement-breakpoint
CREATE INDEX "reward_notices_unseen_idx" ON "reward_notices" USING btree ("learner_id","seen_at");