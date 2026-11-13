CREATE TYPE "public"."member_photo_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'photos';--> statement-breakpoint
CREATE TABLE "member_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"status" "member_photo_status" DEFAULT 'pending' NOT NULL,
	"game_id" uuid,
	"event_id" uuid,
	"team_id" uuid,
	"caption" text,
	"repost_consent_at" timestamp with time zone NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"bytes" "bytea",
	"byte_size" integer,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_photo_type" CHECK ("member_photo"."content_type" = 'image/jpeg'),
	CONSTRAINT "member_photo_bytes_unless_rejected" CHECK (("member_photo"."status" = 'rejected') = ("member_photo"."bytes" is null) and ("member_photo"."bytes" is null) = ("member_photo"."byte_size" is null)),
	CONSTRAINT "member_photo_size" CHECK ("member_photo"."bytes" is null or ("member_photo"."byte_size" = octet_length("member_photo"."bytes") and "member_photo"."byte_size" between 1 and 1048576)),
	CONSTRAINT "member_photo_dimensions" CHECK ("member_photo"."width" between 1 and 1440 and "member_photo"."height" between 1 and 1440),
	CONSTRAINT "member_photo_caption_length" CHECK (char_length("member_photo"."caption") <= 200),
	CONSTRAINT "member_photo_note_length" CHECK (char_length("member_photo"."review_note") <= 500),
	CONSTRAINT "member_photo_reviewed" CHECK (("member_photo"."status" = 'pending') = ("member_photo"."reviewed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_photo" ADD CONSTRAINT "member_photo_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_photo_league_status" ON "member_photo" USING btree ("league_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_photo_uploader" ON "member_photo" USING btree ("uploader_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_photo_team" ON "member_photo" USING btree ("team_id","created_at" DESC NULLS LAST) WHERE "member_photo"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "member_photo_event" ON "member_photo" USING btree ("event_id","created_at" DESC NULLS LAST) WHERE "member_photo"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "member_photo_game" ON "member_photo" USING btree ("game_id","created_at" DESC NULLS LAST) WHERE "member_photo"."status" = 'approved';