CREATE TYPE "public"."lost_found_claim_status" AS ENUM('open', 'handed_over', 'withdrawn', 'closed');--> statement-breakpoint
CREATE TYPE "public"."lost_found_kind" AS ENUM('found', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lost_found_status" AS ENUM('open', 'returned', 'closed', 'expired', 'removed');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'lost_found';--> statement-breakpoint
CREATE TABLE "lost_found_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"responder_id" uuid NOT NULL,
	"status" "lost_found_claim_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "lost_found_claim_once" UNIQUE("item_id","responder_id"),
	CONSTRAINT "lost_found_claim_closed_when_not_open" CHECK (("lost_found_claim"."status" = 'open') = ("lost_found_claim"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "lost_found_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"poster_id" uuid NOT NULL,
	"kind" "lost_found_kind" NOT NULL,
	"description" text NOT NULL,
	"place" text NOT NULL,
	"where_now" text,
	"status" "lost_found_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"removed_by" uuid,
	"had_photo" boolean DEFAULT false NOT NULL,
	"content_type" text DEFAULT 'image/jpeg' NOT NULL,
	"bytes" "bytea",
	"byte_size" integer,
	"thumb_bytes" "bytea",
	"width" integer,
	"height" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_found_item_closed_when_not_open" CHECK (("lost_found_item"."status" = 'open') = ("lost_found_item"."closed_at" is null)),
	CONSTRAINT "lost_found_item_where_now" CHECK (("lost_found_item"."kind" = 'lost') = ("lost_found_item"."where_now" is null)),
	CONSTRAINT "lost_found_item_photo_together" CHECK (("lost_found_item"."bytes" is null) = ("lost_found_item"."byte_size" is null) and ("lost_found_item"."bytes" is null) = ("lost_found_item"."thumb_bytes" is null) and ("lost_found_item"."bytes" is null) = ("lost_found_item"."sha256" is null) and ("lost_found_item"."bytes" is null) = ("lost_found_item"."width" is null) and ("lost_found_item"."bytes" is null) = ("lost_found_item"."height" is null)),
	CONSTRAINT "lost_found_item_photo_open_only" CHECK ("lost_found_item"."bytes" is null or "lost_found_item"."status" = 'open'),
	CONSTRAINT "lost_found_item_type" CHECK ("lost_found_item"."content_type" = 'image/jpeg'),
	CONSTRAINT "lost_found_item_size" CHECK ("lost_found_item"."bytes" is null or ("lost_found_item"."byte_size" = octet_length("lost_found_item"."bytes") and "lost_found_item"."byte_size" between 1 and 1048576)),
	CONSTRAINT "lost_found_item_text_length" CHECK (char_length("lost_found_item"."description") between 1 and 300 and char_length("lost_found_item"."place") between 1 and 80 and ("lost_found_item"."where_now" is null or char_length("lost_found_item"."where_now") between 1 and 120))
);
--> statement-breakpoint
CREATE TABLE "lost_found_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lost_found_message_length" CHECK (char_length("lost_found_message"."body") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "lost_found_claim" ADD CONSTRAINT "lost_found_claim_item_id_lost_found_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."lost_found_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_claim" ADD CONSTRAINT "lost_found_claim_responder_id_user_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_item" ADD CONSTRAINT "lost_found_item_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_item" ADD CONSTRAINT "lost_found_item_poster_id_user_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_item" ADD CONSTRAINT "lost_found_item_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_message" ADD CONSTRAINT "lost_found_message_claim_id_lost_found_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."lost_found_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_found_message" ADD CONSTRAINT "lost_found_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lost_found_claim_responder" ON "lost_found_claim" USING btree ("responder_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "lost_found_claim_one_handover" ON "lost_found_claim" USING btree ("item_id") WHERE "lost_found_claim"."status" = 'handed_over';--> statement-breakpoint
CREATE INDEX "lost_found_item_board" ON "lost_found_item" USING btree ("league_id","created_at" DESC NULLS LAST) WHERE "lost_found_item"."status" = 'open';--> statement-breakpoint
CREATE INDEX "lost_found_item_poster" ON "lost_found_item" USING btree ("poster_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lost_found_item_closed" ON "lost_found_item" USING btree ("closed_at") WHERE "lost_found_item"."status" <> 'open';--> statement-breakpoint
CREATE INDEX "lost_found_message_claim" ON "lost_found_message" USING btree ("claim_id","created_at");