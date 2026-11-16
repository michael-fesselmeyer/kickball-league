CREATE TYPE "public"."card_color" AS ENUM('yellow', 'red');--> statement-breakpoint
CREATE TABLE "game_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid,
	"color" "card_color" NOT NULL,
	"note" text,
	"given_by" uuid,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_card_note_length" CHECK ("game_card"."note" is null or char_length("game_card"."note") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "game_card" ADD CONSTRAINT "game_card_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_card" ADD CONSTRAINT "game_card_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_card" ADD CONSTRAINT "game_card_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_card" ADD CONSTRAINT "game_card_given_by_user_id_fk" FOREIGN KEY ("given_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_card_game_idx" ON "game_card" USING btree ("game_id","given_at");--> statement-breakpoint
CREATE INDEX "game_card_user_idx" ON "game_card" USING btree ("user_id","given_at");--> statement-breakpoint
CREATE INDEX "game_card_by_idx" ON "game_card" USING btree ("given_by");