CREATE TYPE "public"."captain_handoff_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'team_roles';--> statement-breakpoint
CREATE TABLE "captain_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_season_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" "captain_handoff_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "captain_handoff_someone_else" CHECK ("captain_handoff"."from_user_id" <> "captain_handoff"."to_user_id"),
	CONSTRAINT "captain_handoff_decided" CHECK (("captain_handoff"."status" = 'pending') = ("captain_handoff"."decided_at" is null))
);
--> statement-breakpoint
ALTER TABLE "captain_handoff" ADD CONSTRAINT "captain_handoff_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_handoff" ADD CONSTRAINT "captain_handoff_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_handoff" ADD CONSTRAINT "captain_handoff_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captain_handoff" ADD CONSTRAINT "captain_handoff_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "captain_handoff_one_pending" ON "captain_handoff" USING btree ("team_season_id") WHERE "captain_handoff"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "captain_handoff_to_idx" ON "captain_handoff" USING btree ("to_user_id");