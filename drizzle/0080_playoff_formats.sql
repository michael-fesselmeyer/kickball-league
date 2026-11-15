CREATE TYPE "public"."bracket_stage" AS ENUM('main', 'losers', 'grand_final', 'reset', 'third_place');--> statement-breakpoint
ALTER TYPE "public"."bracket_format" ADD VALUE 'double_elimination';--> statement-breakpoint
ALTER TABLE "bracket" DROP CONSTRAINT "bracket_season_division_unique";--> statement-breakpoint
ALTER TABLE "bracket" ADD COLUMN "tier" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bracket" ADD COLUMN "third_place" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bracket" ADD COLUMN "early_innings" integer;--> statement-breakpoint
ALTER TABLE "bracket" ADD COLUMN "final_innings" integer;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD COLUMN "stage" "bracket_stage" DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD COLUMN "game_no" integer;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_season_division_tier_unique" UNIQUE NULLS NOT DISTINCT("season_id","division_id","tier");--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_game_no_unique" UNIQUE("bracket_id","game_no");--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_tier_range" CHECK ("bracket"."tier" between 1 and 3);--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_innings_range" CHECK (("bracket"."early_innings" is null or "bracket"."early_innings" between 1 and 15) and ("bracket"."final_innings" is null or "bracket"."final_innings" between 1 and 15));--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_third_place_single" CHECK (not "bracket"."third_place" or "bracket"."format" = 'single_elimination');