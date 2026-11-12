CREATE TYPE "public"."score_response_status" AS ENUM('confirmed', 'disputed');--> statement-breakpoint
CREATE TABLE "score_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score_report_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "score_response_status" NOT NULL,
	"note" text,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_response_once" UNIQUE("score_report_id","team_season_id")
);
--> statement-breakpoint
ALTER TABLE "score_report" ADD COLUMN "team_season_id" uuid;--> statement-breakpoint
ALTER TABLE "score_response" ADD CONSTRAINT "score_response_score_report_id_score_report_id_fk" FOREIGN KEY ("score_report_id") REFERENCES "public"."score_report"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_response" ADD CONSTRAINT "score_response_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_response" ADD CONSTRAINT "score_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_report" ADD CONSTRAINT "score_report_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;