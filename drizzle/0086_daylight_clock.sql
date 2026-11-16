CREATE TYPE "public"."score_report_call_reason" AS ENUM('daylight', 'field_time');--> statement-breakpoint
CREATE TYPE "public"."game_start_held_up_by" AS ENUM('team_a', 'team_b', 'both', 'neither');--> statement-breakpoint
CREATE TABLE "game_start" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"held_up_by" "game_start_held_up_by",
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field" ADD COLUMN "has_lights" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "score_report" ADD COLUMN "call_reason" "score_report_call_reason";--> statement-breakpoint
ALTER TABLE "game_start" ADD CONSTRAINT "game_start_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_start" ADD CONSTRAINT "game_start_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_report" ADD CONSTRAINT "score_report_call_reason_called" CHECK ("score_report"."call_reason" is null or "score_report"."outcome" = 'called');