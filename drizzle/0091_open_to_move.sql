CREATE TYPE "public"."move_audience" AS ENUM('admins', 'captains', 'both');--> statement-breakpoint
CREATE TYPE "public"."move_invite_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "move_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"audience" "move_audience" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "move_interest_once" UNIQUE("league_id","user_id"),
	CONSTRAINT "move_interest_note_length" CHECK ("move_interest"."note" is null or char_length("move_interest"."note") between 1 and 140)
);
--> statement-breakpoint
CREATE TABLE "move_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interest_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"sent_by" uuid,
	"message" text,
	"status" "move_invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "move_invite_once" UNIQUE("interest_id","team_id"),
	CONSTRAINT "move_invite_message_length" CHECK ("move_invite"."message" is null or char_length("move_invite"."message") between 1 and 300),
	CONSTRAINT "move_invite_answered" CHECK (("move_invite"."status" = 'pending') = ("move_invite"."responded_at" is null))
);
--> statement-breakpoint
ALTER TABLE "move_interest" ADD CONSTRAINT "move_interest_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_interest" ADD CONSTRAINT "move_interest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_invite" ADD CONSTRAINT "move_invite_interest_id_move_interest_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."move_interest"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_invite" ADD CONSTRAINT "move_invite_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_invite" ADD CONSTRAINT "move_invite_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_invite" ADD CONSTRAINT "move_invite_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "move_interest_user_idx" ON "move_interest" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "move_invite_team_idx" ON "move_invite" USING btree ("team_id","season_id");--> statement-breakpoint
CREATE INDEX "move_invite_sent_by_idx" ON "move_invite" USING btree ("sent_by");--> statement-breakpoint
CREATE INDEX "move_invite_season_idx" ON "move_invite" USING btree ("season_id");