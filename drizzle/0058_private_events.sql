CREATE TYPE "public"."private_event_kind" AS ENUM('tournament', 'league');--> statement-breakpoint
CREATE TYPE "public"."private_event_payer" AS ENUM('organization', 'players');--> statement-breakpoint
CREATE TYPE "public"."private_event_status" AS ENUM('requested', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."season_visibility" AS ENUM('league', 'private');--> statement-breakpoint
ALTER TYPE "public"."purchase_item_kind" ADD VALUE 'private_event';--> statement-breakpoint
CREATE TABLE "private_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"organizer_id" uuid NOT NULL,
	"kind" "private_event_kind" NOT NULL,
	"status" "private_event_status" DEFAULT 'requested' NOT NULL,
	"organization" text NOT NULL,
	"teams" integer NOT NULL,
	"preferred_dates" text NOT NULL,
	"note" text,
	"season_id" uuid,
	"payer" "private_event_payer",
	"price_cents" integer,
	"invite_token" text,
	"paid_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_event_season_unique" UNIQUE("season_id"),
	CONSTRAINT "private_event_invite_token_unique" UNIQUE("invite_token"),
	CONSTRAINT "private_event_teams_range" CHECK ("private_event"."teams" between 2 and 32),
	CONSTRAINT "private_event_text_lengths" CHECK (length("private_event"."organization") between 1 and 120 and length("private_event"."preferred_dates") between 1 and 300 and coalesce(length("private_event"."note"), 0) <= 2000),
	CONSTRAINT "private_event_accepted_has_season" CHECK (("private_event"."status" = 'accepted') = ("private_event"."season_id" is not null and "private_event"."payer" is not null and "private_event"."invite_token" is not null)),
	CONSTRAINT "private_event_price" CHECK ("private_event"."price_cents" is null or "private_event"."price_cents" >= 0),
	CONSTRAINT "private_event_organization_pays_price" CHECK ("private_event"."payer" is distinct from 'organization' or "private_event"."price_cents" is not null)
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "visibility" "season_visibility" DEFAULT 'league' NOT NULL;--> statement-breakpoint
ALTER TABLE "private_event" ADD CONSTRAINT "private_event_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_event" ADD CONSTRAINT "private_event_organizer_id_user_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_event" ADD CONSTRAINT "private_event_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_event" ADD CONSTRAINT "private_event_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_event_league_status_idx" ON "private_event" USING btree ("league_id","status","created_at");--> statement-breakpoint
CREATE INDEX "private_event_organizer_idx" ON "private_event" USING btree ("organizer_id");