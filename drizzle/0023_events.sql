CREATE TYPE "public"."event_kind" AS ENUM('social', 'bar_night', 'bbq', 'tournament', 'theme_week');--> statement-breakpoint
CREATE TYPE "public"."event_rsvp_status" AS ENUM('going', 'waitlisted');--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"kind" "event_kind" DEFAULT 'social' NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"place" text,
	"description" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_slug_format" CHECK ("event"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_ends_after_start" CHECK ("event"."ends_at" > "event"."starts_at"),
	CONSTRAINT "event_capacity_positive" CHECK ("event"."capacity" is null or "event"."capacity" > 0),
	CONSTRAINT "event_theme_week_open" CHECK ("event"."kind" <> 'theme_week' or "event"."capacity" is null)
);
--> statement-breakpoint
CREATE TABLE "event_rsvp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "event_rsvp_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvp_once" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvp" ADD CONSTRAINT "event_rsvp_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_league_starts_idx" ON "event" USING btree ("league_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_rsvp_queue_idx" ON "event_rsvp" USING btree ("event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "event_rsvp_user_idx" ON "event_rsvp" USING btree ("user_id");