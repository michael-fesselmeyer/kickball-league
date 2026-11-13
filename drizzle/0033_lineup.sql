CREATE TABLE "game_lineup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"run_breaks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "game_lineup_once" UNIQUE("game_id","team_season_id"),
	CONSTRAINT "game_lineup_run_breaks" CHECK ("game_lineup"."run_breaks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "game_lineup_spot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lineup_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"pickup" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_lineup_spot_position" UNIQUE("lineup_id","position"),
	CONSTRAINT "game_lineup_spot_once" UNIQUE("lineup_id","user_id"),
	CONSTRAINT "game_lineup_spot_position_range" CHECK ("game_lineup_spot"."position" between 1 and 40)
);
--> statement-breakpoint
ALTER TABLE "game_lineup" ADD CONSTRAINT "game_lineup_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineup" ADD CONSTRAINT "game_lineup_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineup" ADD CONSTRAINT "game_lineup_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineup" ADD CONSTRAINT "game_lineup_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineup_spot" ADD CONSTRAINT "game_lineup_spot_lineup_id_game_lineup_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."game_lineup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_lineup_spot" ADD CONSTRAINT "game_lineup_spot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_lineup_team_idx" ON "game_lineup" USING btree ("team_season_id");--> statement-breakpoint
CREATE INDEX "game_lineup_spot_user_idx" ON "game_lineup_spot" USING btree ("user_id");