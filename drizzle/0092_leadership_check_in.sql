CREATE TYPE "public"."leadership_answer" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."leadership_captain_choice" AS ENUM('hand_off_now', 'captain_elect');--> statement-breakpoint
CREATE TYPE "public"."leadership_outcome" AS ENUM('no_quorum', 'no_candidates', 'no_majority', 'captain_stays', 'new_captain', 'winner_left', 'closed_by_league');--> statement-breakpoint
CREATE TYPE "public"."leadership_part" AS ENUM('check_in', 'ballot');--> statement-breakpoint
CREATE TYPE "public"."leadership_role" AS ENUM('captain', 'co_captain');--> statement-breakpoint
CREATE TYPE "public"."leadership_step" AS ENUM('check_in', 'ballot', 'captain_review', 'closed');--> statement-breakpoint
CREATE TABLE "leadership_ballot_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "leadership_ballot_option_once" UNIQUE("check_in_id","user_id"),
	CONSTRAINT "leadership_ballot_option_votes" CHECK ("leadership_ballot_option"."votes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leadership_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_in_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "leadership_role" NOT NULL,
	"volunteered" boolean DEFAULT false NOT NULL,
	"nominated" boolean DEFAULT false NOT NULL,
	"asked_at" timestamp with time zone,
	"answer" "leadership_answer",
	"answered_at" timestamp with time zone,
	CONSTRAINT "leadership_candidate_once" UNIQUE("check_in_id","user_id","role"),
	CONSTRAINT "leadership_candidate_answered" CHECK (("leadership_candidate"."answer" is null) = ("leadership_candidate"."answered_at" is null))
);
--> statement-breakpoint
CREATE TABLE "leadership_check_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_season_id" uuid NOT NULL,
	"step" "leadership_step" DEFAULT 'check_in' NOT NULL,
	"outcome" "leadership_outcome",
	"quorum_percent" smallint NOT NULL,
	"captain_stepping_down" boolean DEFAULT false NOT NULL,
	"check_in_closes_at" timestamp with time zone NOT NULL,
	"ballot_closes_at" timestamp with time zone,
	"review_ends_at" timestamp with time zone,
	"elected_user_id" uuid,
	"captain_choice" "leadership_captain_choice",
	"elect_offered_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"opened_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "leadership_check_in_teamSeasonId_unique" UNIQUE("team_season_id"),
	CONSTRAINT "leadership_check_in_closed" CHECK (("leadership_check_in"."step" = 'closed') = ("leadership_check_in"."closed_at" is not null) and ("leadership_check_in"."step" <> 'closed' or "leadership_check_in"."outcome" is not null)),
	CONSTRAINT "leadership_check_in_quorum" CHECK ("leadership_check_in"."quorum_percent" between 50 and 100),
	CONSTRAINT "leadership_check_in_review" CHECK ("leadership_check_in"."step" <> 'captain_review' or ("leadership_check_in"."review_ends_at" is not null and "leadership_check_in"."outcome" is not null)),
	CONSTRAINT "leadership_check_in_elected" CHECK ("leadership_check_in"."outcome" is distinct from 'new_captain' or "leadership_check_in"."elected_user_id" is not null),
	CONSTRAINT "leadership_check_in_ballot" CHECK ("leadership_check_in"."step" not in ('ballot', 'captain_review') or "leadership_check_in"."ballot_closes_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "leadership_participation" (
	"check_in_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"part" "leadership_part" NOT NULL,
	CONSTRAINT "leadership_participation_check_in_id_user_id_part_pk" PRIMARY KEY("check_in_id","user_id","part")
);
--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "leadership_quorum_percent" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "leadership_ballot_option" ADD CONSTRAINT "leadership_ballot_option_check_in_id_leadership_check_in_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."leadership_check_in"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_ballot_option" ADD CONSTRAINT "leadership_ballot_option_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_candidate" ADD CONSTRAINT "leadership_candidate_check_in_id_leadership_check_in_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."leadership_check_in"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_candidate" ADD CONSTRAINT "leadership_candidate_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_check_in" ADD CONSTRAINT "leadership_check_in_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_check_in" ADD CONSTRAINT "leadership_check_in_elected_user_id_user_id_fk" FOREIGN KEY ("elected_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_check_in" ADD CONSTRAINT "leadership_check_in_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_participation" ADD CONSTRAINT "leadership_participation_check_in_id_leadership_check_in_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."leadership_check_in"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_participation" ADD CONSTRAINT "leadership_participation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leadership_ballot_option_user_idx" ON "leadership_ballot_option" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leadership_candidate_user_idx" ON "leadership_candidate" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "leadership_check_in_step_idx" ON "leadership_check_in" USING btree ("step");--> statement-breakpoint
CREATE INDEX "leadership_participation_user_idx" ON "leadership_participation" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_leadership_quorum" CHECK ("league"."leadership_quorum_percent" between 50 and 100);