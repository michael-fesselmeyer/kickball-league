CREATE TYPE "public"."event_audience" AS ENUM('public', 'members', 'teams');--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'party';--> statement-breakpoint
CREATE TABLE "calendar_feed" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_audience_team" (
	"event_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "event_audience_team_event_id_team_id_pk" PRIMARY KEY("event_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "audience" "event_audience" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "audience_season_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "invite_url" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "in_app_rsvp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_team" ADD CONSTRAINT "event_audience_team_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_team" ADD CONSTRAINT "event_audience_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_audience_team_team_idx" ON "event_audience_team" USING btree ("team_id");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_audience_season_id_season_id_fk" FOREIGN KEY ("audience_season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_theme_week_public" CHECK ("event"."kind" <> 'theme_week' or "event"."audience" = 'public');--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_audience_season_teams" CHECK ("event"."audience" = 'teams' or "event"."audience_season_id" is null);--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_invite_url_https" CHECK ("event"."invite_url" is null or ("event"."invite_url" ~ '^https://' and length("event"."invite_url") <= 500));