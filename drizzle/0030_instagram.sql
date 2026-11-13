CREATE TYPE "public"."social_account_status" AS ENUM('active', 'needs_reconnect', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."social_cover" AS ENUM('home', 'team');--> statement-breakpoint
CREATE TYPE "public"."social_media_type" AS ENUM('image', 'video', 'carousel');--> statement-breakpoint
CREATE TYPE "public"."social_provider" AS ENUM('instagram');--> statement-breakpoint
CREATE TABLE "social_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"external_id" text NOT NULL,
	"username" text NOT NULL,
	"status" "social_account_status" DEFAULT 'active' NOT NULL,
	"token_ciphertext" text,
	"token_expires_at" timestamp with time zone,
	"token_refreshed_at" timestamp with time zone,
	"show_newest" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_account_league_provider" UNIQUE("league_id","provider"),
	CONSTRAINT "social_account_token_matches_status" CHECK (("social_account"."status" = 'disconnected') = ("social_account"."token_ciphertext" is null))
);
--> statement-breakpoint
CREATE TABLE "social_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_image_postId_unique" UNIQUE("post_id"),
	CONSTRAINT "social_image_type" CHECK ("social_image"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "social_image_size" CHECK ("social_image"."byte_size" = octet_length("social_image"."bytes") and "social_image"."byte_size" between 1 and 2097152)
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"permalink" text NOT NULL,
	"caption" text,
	"media_type" "social_media_type" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"team_id" uuid,
	"event_id" uuid,
	"cover" "social_cover",
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_post_once" UNIQUE("account_id","external_id"),
	CONSTRAINT "social_post_https_permalink" CHECK ("social_post"."permalink" ~ '^https://www\.instagram\.com/'),
	CONSTRAINT "social_post_hidden_not_shown" CHECK (not ("social_post"."hidden" and ("social_post"."featured" or "social_post"."cover" is not null))),
	CONSTRAINT "social_post_team_cover_has_team" CHECK ("social_post"."cover" is distinct from 'team' or "social_post"."team_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_image" ADD CONSTRAINT "social_image_post_id_social_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_account_id_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_post_account_taken" ON "social_post" USING btree ("account_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "social_post_team" ON "social_post" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "social_post_event" ON "social_post" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_post_one_home_cover" ON "social_post" USING btree ("account_id") WHERE "social_post"."cover" = 'home';--> statement-breakpoint
CREATE UNIQUE INDEX "social_post_one_team_cover" ON "social_post" USING btree ("team_id") WHERE "social_post"."cover" = 'team';