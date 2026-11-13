CREATE TYPE "public"."team_formation_request_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'new_team';--> statement-breakpoint
CREATE TABLE "team_formation_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"proposed_name" text NOT NULL,
	"expected_size" integer NOT NULL,
	"payment_mode" "team_season_payment_mode" DEFAULT 'split' NOT NULL,
	"note" text,
	"status" "team_formation_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"team_season_id" uuid,
	"left_team_season_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_formation_request_sizes" CHECK ("team_formation_request"."expected_size" between 1 and 60),
	CONSTRAINT "team_formation_request_text_lengths" CHECK (char_length("team_formation_request"."proposed_name") between 1 and 40 and ("team_formation_request"."note" is null or char_length("team_formation_request"."note") <= 500) and ("team_formation_request"."decline_reason" is null or char_length("team_formation_request"."decline_reason") <= 500)),
	CONSTRAINT "team_formation_request_decided" CHECK (("team_formation_request"."status" in ('approved', 'declined')) = ("team_formation_request"."decided_at" is not null)),
	CONSTRAINT "team_formation_request_approved_has_team" CHECK (("team_formation_request"."status" = 'approved') = ("team_formation_request"."team_season_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "team_formation_request" ADD CONSTRAINT "team_formation_request_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_formation_request" ADD CONSTRAINT "team_formation_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_formation_request" ADD CONSTRAINT "team_formation_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_formation_request" ADD CONSTRAINT "team_formation_request_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_formation_request" ADD CONSTRAINT "team_formation_request_left_team_season_id_team_season_id_fk" FOREIGN KEY ("left_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_formation_request_one_pending" ON "team_formation_request" USING btree ("season_id","requested_by") WHERE "team_formation_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_formation_request_season_idx" ON "team_formation_request" USING btree ("season_id","status","created_at");--> statement-breakpoint
CREATE INDEX "team_formation_request_user_idx" ON "team_formation_request" USING btree ("requested_by");