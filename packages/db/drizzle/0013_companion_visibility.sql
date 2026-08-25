SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
ALTER TABLE "learner_reward_loadouts" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "learner_reward_loadouts" ADD CONSTRAINT "learner_reward_loadouts_hidden_companion_only" CHECK ("learner_reward_loadouts"."hidden" = false OR "learner_reward_loadouts"."slot" = 'companion');
