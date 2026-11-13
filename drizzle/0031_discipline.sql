CREATE TYPE "public"."incident_kind" AS ENUM('ejection', 'forfeit_related', 'unsportsmanlike', 'outside_alcohol', 'safety', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_reporter_role" AS ENUM('referee', 'captain', 'admin');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."suspension_scope" AS ENUM('games', 'season', 'permanent');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'discipline';--> statement-breakpoint
CREATE TABLE "incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"kind" "incident_kind" NOT NULL,
	"details" text NOT NULL,
	"reported_by" uuid,
	"reporter_role" "incident_reporter_role" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incident_details_length" CHECK (char_length("incident"."details") between 1 and 2000),
	CONSTRAINT "incident_resolved_at" CHECK (("incident"."status" = 'resolved') = ("incident"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "incident_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_note_body_length" CHECK (char_length("incident_note"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "incident_person" (
	"incident_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid,
	CONSTRAINT "incident_person_incident_id_user_id_pk" PRIMARY KEY("incident_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sportsmanship_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"rated_team_season_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"note" text,
	"rated_by" uuid,
	"rated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sportsmanship_rating_once" UNIQUE("game_id","team_season_id"),
	CONSTRAINT "sportsmanship_rating_score" CHECK ("sportsmanship_rating"."score" between 1 and 5),
	CONSTRAINT "sportsmanship_rating_other_team" CHECK ("sportsmanship_rating"."team_season_id" <> "sportsmanship_rating"."rated_team_season_id"),
	CONSTRAINT "sportsmanship_rating_note_length" CHECK ("sportsmanship_rating"."note" is null or char_length("sportsmanship_rating"."note") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "suspension" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"scope" "suspension_scope" NOT NULL,
	"games" integer,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by" uuid,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	CONSTRAINT "suspension_once_per_incident" UNIQUE("incident_id","user_id"),
	CONSTRAINT "suspension_games" CHECK (("suspension"."scope" = 'games') = ("suspension"."games" is not null) and ("suspension"."games" is null or "suspension"."games" between 1 and 20))
);
--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_reported_by_user_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_note" ADD CONSTRAINT "incident_note_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_note" ADD CONSTRAINT "incident_note_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_person" ADD CONSTRAINT "incident_person_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_person" ADD CONSTRAINT "incident_person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_person" ADD CONSTRAINT "incident_person_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportsmanship_rating" ADD CONSTRAINT "sportsmanship_rating_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportsmanship_rating" ADD CONSTRAINT "sportsmanship_rating_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportsmanship_rating" ADD CONSTRAINT "sportsmanship_rating_rated_team_season_id_team_season_id_fk" FOREIGN KEY ("rated_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportsmanship_rating" ADD CONSTRAINT "sportsmanship_rating_rated_by_user_id_fk" FOREIGN KEY ("rated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspension" ADD CONSTRAINT "suspension_lifted_by_user_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_status_reported_idx" ON "incident" USING btree ("status","reported_at");--> statement-breakpoint
CREATE INDEX "incident_game_idx" ON "incident" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "incident_note_incident_idx" ON "incident_note" USING btree ("incident_id","written_at");--> statement-breakpoint
CREATE INDEX "incident_note_author_idx" ON "incident_note" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "incident_person_user_idx" ON "incident_person" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sportsmanship_rating_rated_idx" ON "sportsmanship_rating" USING btree ("rated_team_season_id");--> statement-breakpoint
CREATE INDEX "sportsmanship_rating_by_idx" ON "sportsmanship_rating" USING btree ("rated_by");--> statement-breakpoint
CREATE INDEX "suspension_user_idx" ON "suspension" USING btree ("user_id");