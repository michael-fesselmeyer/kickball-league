CREATE TYPE "public"."game_rsvp_status" AS ENUM('in', 'out', 'maybe');--> statement-breakpoint
CREATE TABLE "game_rsvp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"status" "game_rsvp_status" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_rsvp_once" UNIQUE("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_rsvp" ADD CONSTRAINT "game_rsvp_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rsvp" ADD CONSTRAINT "game_rsvp_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rsvp" ADD CONSTRAINT "game_rsvp_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_rsvp_team_idx" ON "game_rsvp" USING btree ("game_id","team_season_id");