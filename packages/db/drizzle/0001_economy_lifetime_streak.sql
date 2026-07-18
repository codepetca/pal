ALTER TABLE "economy" ADD COLUMN "xp_lifetime" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "economy" ADD COLUMN "streak_last_day" date;--> statement-breakpoint
-- Backfill before the constraint: any pre-existing row with a positive balance has
-- earned at least that much lifetime XP (spends since then are unknowable, so the
-- balance is the best lower bound). Without this, xp > 0 rows would violate the check.
UPDATE "economy" SET "xp_lifetime" = "xp" WHERE "xp" > "xp_lifetime";--> statement-breakpoint
ALTER TABLE "economy" ADD CONSTRAINT "economy_xp_lifetime_gte_xp" CHECK ("economy"."xp_lifetime" >= "economy"."xp");