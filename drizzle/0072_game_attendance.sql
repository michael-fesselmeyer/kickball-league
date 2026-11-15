CREATE TYPE "public"."attendance_method" AS ENUM('scan', 'marked');--> statement-breakpoint
CREATE TABLE "game_attendance" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"method" "attendance_method" NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_attendance_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "playoff_min_games" smallint;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_attendance" ADD CONSTRAINT "game_attendance_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_attendance_user_idx" ON "game_attendance" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_attendance_team_idx" ON "game_attendance" USING btree ("team_season_id","game_id");--> statement-breakpoint
CREATE INDEX "game_attendance_recorded_by_idx" ON "game_attendance" USING btree ("recorded_by");--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_playoff_min_games" CHECK ("season"."playoff_min_games" is null or "season"."playoff_min_games" between 1 and 30);