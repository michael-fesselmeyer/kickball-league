CREATE TYPE "public"."concern_category" AS ENUM('question', 'field_problem', 'play', 'safety', 'treatment', 'park_rules', 'other');--> statement-breakpoint
CREATE TYPE "public"."concern_message_kind" AS ENUM('reply', 'note');--> statement-breakpoint
CREATE TYPE "public"."concern_source" AS ENUM('public', 'player');--> statement-breakpoint
CREATE TYPE "public"."concern_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."park_rule" AS ENUM('outside_hours', 'alcohol_glass', 'amplified_sound', 'litter', 'field_damage', 'shared_space');--> statement-breakpoint
CREATE TABLE "concern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"source" "concern_source" NOT NULL,
	"category" "concern_category" NOT NULL,
	"park_rule" "park_rule",
	"body" text NOT NULL,
	"occurred_on" date,
	"place" text,
	"game_id" uuid,
	"team_id" uuid,
	"sender_id" uuid,
	"reply_email" text,
	"status" "concern_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_replied_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"outcome" text,
	CONSTRAINT "concern_body_length" CHECK (char_length("concern"."body") between 1 and 2000),
	CONSTRAINT "concern_place_length" CHECK ("concern"."place" is null or char_length("concern"."place") between 1 and 80),
	CONSTRAINT "concern_reply_email_length" CHECK ("concern"."reply_email" is null or char_length("concern"."reply_email") between 3 and 254),
	CONSTRAINT "concern_outcome_length" CHECK ("concern"."outcome" is null or char_length("concern"."outcome") between 1 and 1000),
	CONSTRAINT "concern_park_rule_category" CHECK ("concern"."park_rule" is null or "concern"."category" = 'park_rules'),
	CONSTRAINT "concern_closed_at" CHECK (("concern"."status" = 'closed') = ("concern"."closed_at" is not null)),
	CONSTRAINT "concern_public_has_no_sender" CHECK ("concern"."source" <> 'public' or "concern"."sender_id" is null)
);
--> statement-breakpoint
CREATE TABLE "concern_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concern_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" "concern_message_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concern_message_body_length" CHECK (char_length("concern_message"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "message" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "incident" ADD COLUMN "park_rule" "park_rule";--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "recipient_email" text;--> statement-breakpoint
ALTER TABLE "concern" ADD CONSTRAINT "concern_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern" ADD CONSTRAINT "concern_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern" ADD CONSTRAINT "concern_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern" ADD CONSTRAINT "concern_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern" ADD CONSTRAINT "concern_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern_message" ADD CONSTRAINT "concern_message_concern_id_concern_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."concern"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concern_message" ADD CONSTRAINT "concern_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concern_queue_idx" ON "concern" USING btree ("league_id","status","created_at");--> statement-breakpoint
CREATE INDEX "concern_sender_idx" ON "concern" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "concern_game_idx" ON "concern" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "concern_purge_idx" ON "concern" USING btree ("closed_at") WHERE "concern"."reply_email" is not null;--> statement-breakpoint
CREATE INDEX "concern_message_concern_idx" ON "concern_message" USING btree ("concern_id","created_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_has_recipient" CHECK ("message"."user_id" is not null or "message"."recipient_email" is not null);