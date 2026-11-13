CREATE TYPE "public"."award_category" AS ENUM('mvp', 'best_play', 'best_sport', 'newcomer', 'team_spirit', 'best_dressed');--> statement-breakpoint
CREATE TYPE "public"."award_poll_kind" AS ENUM('weekly', 'season');--> statement-breakpoint
CREATE TABLE "award_poll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"kind" "award_poll_kind" NOT NULL,
	"category" "award_category" NOT NULL,
	"title" text NOT NULL,
	"game_day" date,
	"opens_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_poll_times_order" CHECK ("award_poll"."closes_at" > "award_poll"."opens_at"),
	CONSTRAINT "award_poll_game_day_weekly" CHECK (("award_poll"."kind" = 'weekly') = ("award_poll"."game_day" is not null)),
	CONSTRAINT "award_poll_title_length" CHECK (char_length("award_poll"."title") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "award_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_poll_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"nominee_user_id" uuid,
	"nominee_team_season_id" uuid,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_vote_once" UNIQUE("award_poll_id","voter_id"),
	CONSTRAINT "award_vote_one_nominee" CHECK (("award_vote"."nominee_user_id" is null) <> ("award_vote"."nominee_team_season_id" is null)),
	CONSTRAINT "award_vote_not_self" CHECK ("award_vote"."nominee_user_id" is null or "award_vote"."nominee_user_id" <> "award_vote"."voter_id")
);
--> statement-breakpoint
ALTER TABLE "award_poll" ADD CONSTRAINT "award_poll_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_poll" ADD CONSTRAINT "award_poll_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_vote" ADD CONSTRAINT "award_vote_award_poll_id_award_poll_id_fk" FOREIGN KEY ("award_poll_id") REFERENCES "public"."award_poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_vote" ADD CONSTRAINT "award_vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_vote" ADD CONSTRAINT "award_vote_nominee_user_id_user_id_fk" FOREIGN KEY ("nominee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_vote" ADD CONSTRAINT "award_vote_nominee_team_season_id_team_season_id_fk" FOREIGN KEY ("nominee_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "award_poll_season_closes_idx" ON "award_poll" USING btree ("season_id","closes_at");--> statement-breakpoint
CREATE INDEX "award_vote_voter_idx" ON "award_vote" USING btree ("voter_id");