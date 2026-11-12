CREATE TYPE "public"."game_kind" AS ENUM('regular', 'playoff', 'exhibition');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'in_progress', 'final', 'postponed', 'cancelled', 'forfeit');--> statement-breakpoint
CREATE TYPE "public"."score_report_outcome" AS ENUM('normal', 'forfeit_a', 'forfeit_b', 'called');--> statement-breakpoint
CREATE TYPE "public"."score_report_reporter_role" AS ENUM('referee', 'captain', 'admin');--> statement-breakpoint
CREATE TYPE "public"."slot_kind" AS ENUM('regular', 'makeup_reserve', 'playoff');--> statement-breakpoint
CREATE TYPE "public"."slot_status" AS ENUM('open', 'cancelled');--> statement-breakpoint
CREATE TABLE "field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "field_venue_name_unique" UNIQUE("venue_id","name")
);
--> statement-breakpoint
CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"round_no" integer,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"kind" "game_kind" DEFAULT 'regular' NOT NULL,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"slot_id" uuid,
	"score_a" integer,
	"score_b" integer,
	"innings_played" integer,
	"forfeit_by" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "game_distinct_teams" CHECK ("game"."team_a_id" <> "game"."team_b_id"),
	CONSTRAINT "game_scores_non_negative" CHECK (coalesce("game"."score_a", 0) >= 0 and coalesce("game"."score_b", 0) >= 0),
	CONSTRAINT "game_final_has_score" CHECK ("game"."status" <> 'final' or ("game"."score_a" is not null and "game"."score_b" is not null and "game"."finalized_at" is not null)),
	CONSTRAINT "game_forfeit_by_a_team" CHECK (("game"."status" = 'forfeit') = ("game"."forfeit_by" is not null) and ("game"."forfeit_by" is null or "game"."forfeit_by" in ("game"."team_a_id", "game"."team_b_id")))
);
--> statement-breakpoint
CREATE TABLE "score_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"reporter_role" "score_report_reporter_role" NOT NULL,
	"score_a" integer NOT NULL,
	"score_b" integer NOT NULL,
	"innings_played" integer,
	"outcome" "score_report_outcome" DEFAULT 'normal' NOT NULL,
	"client_id" text NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_report_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "score_report_scores_non_negative" CHECK ("score_report"."score_a" >= 0 and "score_report"."score_b" >= 0)
);
--> statement-breakpoint
CREATE TABLE "slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"time_index" integer NOT NULL,
	"kind" "slot_kind" DEFAULT 'regular' NOT NULL,
	"status" "slot_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "slot_field_start_unique" UNIQUE("field_id","starts_at"),
	CONSTRAINT "slot_times_order" CHECK ("slot"."ends_at" > "slot"."starts_at"),
	CONSTRAINT "slot_time_index_non_negative" CHECK ("slot"."time_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "venue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"neighborhood" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "venue_league_slug_unique" UNIQUE("league_id","slug"),
	CONSTRAINT "venue_slug_format" CHECK ("venue"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "field" ADD CONSTRAINT "field_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field" ADD CONSTRAINT "field_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_team_a_id_team_season_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_team_b_id_team_season_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_forfeit_by_team_season_id_fk" FOREIGN KEY ("forfeit_by") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_report" ADD CONSTRAINT "score_report_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_report" ADD CONSTRAINT "score_report_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue" ADD CONSTRAINT "venue_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue" ADD CONSTRAINT "venue_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_season_status_idx" ON "game" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "game_team_a_idx" ON "game" USING btree ("team_a_id");--> statement-breakpoint
CREATE INDEX "game_team_b_idx" ON "game" USING btree ("team_b_id");--> statement-breakpoint
CREATE INDEX "game_slot_idx" ON "game" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "score_report_game_idx" ON "score_report" USING btree ("game_id","reported_at");--> statement-breakpoint
CREATE INDEX "slot_season_starts_idx" ON "slot" USING btree ("season_id","starts_at");