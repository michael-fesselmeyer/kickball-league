CREATE TYPE "public"."game_period_half" AS ENUM('top', 'bottom');--> statement-breakpoint
CREATE TABLE "game_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"period_no" integer NOT NULL,
	"half" "game_period_half" NOT NULL,
	"runs" integer NOT NULL,
	"entered_by" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_period_once" UNIQUE("game_id","period_no","half"),
	CONSTRAINT "game_period_no_range" CHECK ("game_period"."period_no" between 1 and 20),
	CONSTRAINT "game_period_runs_range" CHECK ("game_period"."runs" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "kicks_first" uuid;--> statement-breakpoint
ALTER TABLE "game_period" ADD CONSTRAINT "game_period_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_period" ADD CONSTRAINT "game_period_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_kicks_first_team_season_id_fk" FOREIGN KEY ("kicks_first") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_kicks_first_a_team" CHECK ("game"."kicks_first" is null or "game"."kicks_first" in ("game"."team_a_id", "game"."team_b_id"));