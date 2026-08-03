ALTER TABLE "weekly_rhythm_configs" DROP CONSTRAINT "weekly_rhythm_configs_target_days_range";--> statement-breakpoint
ALTER TABLE "achievement_instances" DROP CONSTRAINT "achievement_instances_source_fact_id_learner_facts_id_fk";
--> statement-breakpoint
ALTER TABLE "learner_facts" DROP CONSTRAINT "learner_facts_integration_id_integrations_id_fk";
--> statement-breakpoint
ALTER TABLE "learner_facts" DROP CONSTRAINT "learner_facts_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "learner_facts" DROP CONSTRAINT "learner_facts_source_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "reward_notices" DROP CONSTRAINT "reward_notices_learner_id_learners_id_fk";
--> statement-breakpoint
ALTER TABLE "reward_notices" DROP CONSTRAINT "reward_notices_achievement_instance_id_achievement_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "weekly_rhythm_configs" DROP COLUMN "target_days";--> statement-breakpoint
ALTER TABLE "learners" ADD CONSTRAINT "learners_id_integration_uq" UNIQUE("id","integration_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_id_learner_integration_uq" UNIQUE("id","learner_id","integration_id");--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_id_learner_uq" UNIQUE("id","learner_id");--> statement-breakpoint
ALTER TABLE "achievement_instances" ADD CONSTRAINT "achievement_instances_id_learner_uq" UNIQUE("id","learner_id");--> statement-breakpoint
ALTER TABLE "achievement_instances" ADD CONSTRAINT "achievement_instances_source_owner_fk" FOREIGN KEY ("source_fact_id","learner_id") REFERENCES "public"."learner_facts"("id","learner_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement_instances" ADD CONSTRAINT "achievement_instances_period_owner_fk" FOREIGN KEY ("learner_id","period_key") REFERENCES "public"."achievement_periods"("learner_id","period_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_learner_integration_owner_fk" FOREIGN KEY ("learner_id","integration_id") REFERENCES "public"."learners"("id","integration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_facts" ADD CONSTRAINT "learner_facts_source_owner_fk" FOREIGN KEY ("source_event_id","learner_id","integration_id") REFERENCES "public"."events"("id","learner_id","integration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_notices" ADD CONSTRAINT "reward_notices_achievement_owner_fk" FOREIGN KEY ("achievement_instance_id","learner_id") REFERENCES "public"."achievement_instances"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_rhythm_configs" ADD CONSTRAINT "weekly_rhythm_configs_period_owner_fk" FOREIGN KEY ("learner_id","period_key") REFERENCES "public"."achievement_periods"("learner_id","period_key") ON DELETE cascade ON UPDATE no action;
