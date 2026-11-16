CREATE TYPE "public"."captain_poll_results" AS ENUM('after_voting', 'at_close');--> statement-breakpoint
CREATE TABLE "captain_poll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"include_co_captains" boolean DEFAULT false NOT NULL,
	"results" "captain_poll_results" DEFAULT 'after_voting' NOT NULL,
	"opens_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captain_poll_times_order" CHECK ("captain_poll"."closes_at" > "captain_poll"."opens_at"),
	CONSTRAINT "captain_poll_title_length" CHECK (char_length("captain_poll"."title") between 1 and 120),
	CONSTRAINT "captain_poll_detail_length" CHECK (char_length("captain_poll"."detail") <= 600)
);
--> statement-breakpoint
CREATE TABLE "captain_poll_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"captain_poll_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "captain_poll_option_position" UNIQUE("captain_poll_id","position"),
	CONSTRAINT "captain_poll_option_position_range" CHECK ("captain_poll_option"."position" between 1 and 5),
	CONSTRAINT "captain_poll_option_label_length" CHECK (char_length("captain_poll_option"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "captain_poll_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"captain_poll_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"voter_id" uuid,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captain_poll_vote_once" UNIQUE("captain_poll_id","team_season_id")
);
--> statement-breakpoint
ALTER TABLE "captain_poll" ADD CONSTRAINT "captain_poll_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll" ADD CONSTRAINT "captain_poll_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll_option" ADD CONSTRAINT "captain_poll_option_captain_poll_id_captain_poll_id_fk" FOREIGN KEY ("captain_poll_id") REFERENCES "public"."captain_poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll_vote" ADD CONSTRAINT "captain_poll_vote_captain_poll_id_captain_poll_id_fk" FOREIGN KEY ("captain_poll_id") REFERENCES "public"."captain_poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll_vote" ADD CONSTRAINT "captain_poll_vote_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll_vote" ADD CONSTRAINT "captain_poll_vote_option_id_captain_poll_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."captain_poll_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_poll_vote" ADD CONSTRAINT "captain_poll_vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captain_poll_season_closes_idx" ON "captain_poll" USING btree ("season_id","closes_at");--> statement-breakpoint
CREATE INDEX "captain_poll_vote_option_idx" ON "captain_poll_vote" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "captain_poll_vote_team_idx" ON "captain_poll_vote" USING btree ("team_season_id");