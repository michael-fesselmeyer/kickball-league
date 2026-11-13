CREATE TYPE "public"."promo_kind" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TABLE "promo_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "promo_kind" NOT NULL,
	"value" integer NOT NULL,
	"max_redemptions" integer,
	"valid_until" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_code_season_code" UNIQUE("season_id","code"),
	CONSTRAINT "promo_code_upper" CHECK ("promo_code"."code" = upper("promo_code"."code")),
	CONSTRAINT "promo_code_value" CHECK (("promo_code"."kind" = 'percent' and "promo_code"."value" between 1 and 100) or ("promo_code"."kind" = 'amount' and "promo_code"."value" > 0)),
	CONSTRAINT "promo_code_max_redemptions" CHECK ("promo_code"."max_redemptions" is null or "promo_code"."max_redemptions" > 0)
);
--> statement-breakpoint
CREATE TABLE "refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"stripe_refund_id" text,
	"amount_cents" integer NOT NULL,
	"reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_stripe_refund_unique" UNIQUE("stripe_refund_id"),
	CONSTRAINT "refund_amount" CHECK ("refund"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "promo_code_id" uuid;--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund" ADD CONSTRAINT "refund_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_payment_idx" ON "refund" USING btree ("payment_id");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_promo_code_id_promo_code_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_promo_code_idx" ON "purchase" USING btree ("promo_code_id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_refunded_cents" CHECK ("payment"."refunded_cents" >= 0 and "payment"."refunded_cents" <= "payment"."amount_cents");