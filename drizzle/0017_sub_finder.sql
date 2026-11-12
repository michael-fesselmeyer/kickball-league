CREATE TYPE "public"."sub_claim_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."sub_request_status" AS ENUM('open', 'filled', 'cancelled');--> statement-breakpoint
CREATE TABLE "sub_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "sub_claim_status" DEFAULT 'pending' NOT NULL,
	"lineup_gender" "profile_lineup_gender",
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_claim_once" UNIQUE("sub_request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sub_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"requested_by" uuid,
	"needed" integer NOT NULL,
	"women_needed" integer DEFAULT 0 NOT NULL,
	"men_needed" integer DEFAULT 0 NOT NULL,
	"note" text,
	"status" "sub_request_status" DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_request_needed_range" CHECK ("sub_request"."needed" between 1 and 11),
	CONSTRAINT "sub_request_gender_within_needed" CHECK ("sub_request"."women_needed" >= 0 and "sub_request"."men_needed" >= 0 and "sub_request"."women_needed" + "sub_request"."men_needed" <= "sub_request"."needed"),
	CONSTRAINT "sub_request_note_length" CHECK ("sub_request"."note" is null or char_length("sub_request"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_sub_request_id_sub_request_id_fk" FOREIGN KEY ("sub_request_id") REFERENCES "public"."sub_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_claim" ADD CONSTRAINT "sub_claim_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request" ADD CONSTRAINT "sub_request_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request" ADD CONSTRAINT "sub_request_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_request" ADD CONSTRAINT "sub_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sub_claim_user_idx" ON "sub_claim" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_request_one_live" ON "sub_request" USING btree ("game_id","team_season_id") WHERE "sub_request"."status" in ('open', 'filled');--> statement-breakpoint
CREATE INDEX "sub_request_team_status_idx" ON "sub_request" USING btree ("team_season_id","status");--> statement-breakpoint
CREATE INDEX "sub_request_open_idx" ON "sub_request" USING btree ("closes_at") WHERE "sub_request"."status" = 'open';