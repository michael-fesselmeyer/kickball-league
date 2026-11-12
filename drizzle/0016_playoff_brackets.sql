CREATE TYPE "public"."bracket_format" AS ENUM('single_elimination');--> statement-breakpoint
CREATE TYPE "public"."bracket_status" AS ENUM('draft', 'published', 'complete');--> statement-breakpoint
CREATE TABLE "bracket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"format" "bracket_format" DEFAULT 'single_elimination' NOT NULL,
	"status" "bracket_status" DEFAULT 'draft' NOT NULL,
	"size" integer NOT NULL,
	"seeds" jsonb NOT NULL,
	"schedule_version_id" uuid,
	"champion_id" uuid,
	"diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "bracket_season_unique" UNIQUE("season_id"),
	CONSTRAINT "bracket_size_range" CHECK ("bracket"."size" between 2 and 32),
	CONSTRAINT "bracket_complete_has_champion" CHECK (("bracket"."status" = 'complete') = ("bracket"."champion_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "bracket_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bracket_id" uuid NOT NULL,
	"code" text NOT NULL,
	"round_no" integer NOT NULL,
	"position" integer NOT NULL,
	"source_a" jsonb NOT NULL,
	"source_b" jsonb NOT NULL,
	"team_a_id" uuid,
	"team_b_id" uuid,
	"slot_id" uuid,
	"game_id" uuid,
	"winner_id" uuid,
	CONSTRAINT "bracket_match_code_unique" UNIQUE("bracket_id","code"),
	CONSTRAINT "bracket_match_game_unique" UNIQUE("game_id"),
	CONSTRAINT "bracket_match_round_positive" CHECK ("bracket_match"."round_no" > 0),
	CONSTRAINT "bracket_match_position_positive" CHECK ("bracket_match"."position" > 0),
	CONSTRAINT "bracket_match_winner_plays" CHECK ("bracket_match"."winner_id" is null or "bracket_match"."winner_id" in ("bracket_match"."team_a_id", "bracket_match"."team_b_id"))
);
--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_schedule_version_id_schedule_version_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "public"."schedule_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_champion_id_team_season_id_fk" FOREIGN KEY ("champion_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_bracket_id_bracket_id_fk" FOREIGN KEY ("bracket_id") REFERENCES "public"."bracket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_team_a_id_team_season_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_team_b_id_team_season_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bracket_match" ADD CONSTRAINT "bracket_match_winner_id_team_season_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bracket_match_bracket_idx" ON "bracket_match" USING btree ("bracket_id","round_no");