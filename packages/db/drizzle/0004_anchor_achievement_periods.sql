ALTER TABLE "achievement_periods" DROP CONSTRAINT "achievement_periods_learner_ordinal_uq";--> statement-breakpoint
ALTER TABLE "achievement_periods" DROP CONSTRAINT "achievement_periods_ordinal_positive";--> statement-breakpoint
ALTER TABLE "achievement_periods" ADD COLUMN "anchor_at" timestamp with time zone;--> statement-breakpoint
UPDATE "achievement_periods" SET "anchor_at" = "created_at" WHERE "anchor_at" IS NULL;--> statement-breakpoint
ALTER TABLE "achievement_periods" ALTER COLUMN "anchor_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "achievement_periods" DROP COLUMN "ordinal";
