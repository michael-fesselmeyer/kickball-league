CREATE TYPE "public"."site_status" AS ENUM('active', 'read_only', 'paused');--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "site_status" "site_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "disabled_features" text[] DEFAULT '{}'::text[] NOT NULL;