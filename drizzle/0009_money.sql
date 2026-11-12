CREATE TYPE "public"."payment_status" AS ENUM('succeeded', 'failed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."purchase_item_kind" AS ENUM('team_fee', 'player_share', 'player_fee', 'free_agent_fee', 'balance', 'event_ticket', 'merch');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('open', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"stripe_fee_cents" integer,
	"status" "payment_status" NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_payment_intent_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid,
	"status" "purchase_status" DEFAULT 'open' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"credit_applied_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"stripe_checkout_session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_checkout_session_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "purchase_amounts" CHECK ("purchase"."subtotal_cents" >= 0 and "purchase"."discount_cents" >= 0 and "purchase"."credit_applied_cents" >= 0 and "purchase"."total_cents" = "purchase"."subtotal_cents" - "purchase"."discount_cents" - "purchase"."credit_applied_cents" and "purchase"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"kind" "purchase_item_kind" NOT NULL,
	"team_season_id" uuid,
	"registration_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "purchase_item_amount" CHECK ("purchase_item"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_event_status" DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_event_once" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_purchase_idx" ON "payment" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_user_idx" ON "purchase" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchase_item_purchase_idx" ON "purchase_item" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_item_registration_idx" ON "purchase_item" USING btree ("registration_id");