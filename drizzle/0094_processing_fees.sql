CREATE TYPE "public"."fee_method" AS ENUM('card', 'bank', 'venmo');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'zelle';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'check';--> statement-breakpoint
ALTER TABLE "purchase" DROP CONSTRAINT "purchase_amounts";--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "processing_fees" jsonb DEFAULT '{"mode":"off"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "fee_method" "fee_method";--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "fee_saved_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "processing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_fee_method" CHECK ("purchase"."fee_cents" = 0 or "purchase"."fee_method" is not null);--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_amounts" CHECK ("purchase"."subtotal_cents" >= 0 and "purchase"."discount_cents" >= 0 and "purchase"."credit_applied_cents" >= 0 and "purchase"."fee_cents" >= 0 and "purchase"."fee_saved_cents" >= 0 and "purchase"."total_cents" = "purchase"."subtotal_cents" - "purchase"."discount_cents" - "purchase"."credit_applied_cents" + "purchase"."fee_cents" and "purchase"."total_cents" >= 0);