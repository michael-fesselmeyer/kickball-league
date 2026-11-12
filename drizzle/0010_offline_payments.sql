CREATE TYPE "public"."payment_method" AS ENUM('stripe', 'cash', 'venmo', 'other');--> statement-breakpoint
ALTER TABLE "payment" ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "method" "payment_method" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "recorded_by" uuid;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_method_fields" CHECK (("payment"."method" = 'stripe') = ("payment"."stripe_payment_intent_id" is not null));