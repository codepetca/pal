SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
ALTER TABLE "learner_reward_grants" ADD CONSTRAINT "learner_reward_grants_id_learner_uq" UNIQUE("id","learner_id");
--> statement-breakpoint
CREATE TABLE "learner_reward_loadouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"reward_grant_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_reward_loadouts_learner_slot_uq" UNIQUE("learner_id","slot"),
	CONSTRAINT "learner_reward_loadouts_grant_uq" UNIQUE("reward_grant_id"),
	CONSTRAINT "learner_reward_loadouts_slot_supported" CHECK ("learner_reward_loadouts"."slot" IN ('companion', 'wallpaper'))
);
--> statement-breakpoint
ALTER TABLE "learner_reward_loadouts" ADD CONSTRAINT "learner_reward_loadouts_grant_owner_fk" FOREIGN KEY ("reward_grant_id","learner_id") REFERENCES "public"."learner_reward_grants"("id","learner_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learner_reward_loadouts_learner_idx" ON "learner_reward_loadouts" USING btree ("learner_id");
