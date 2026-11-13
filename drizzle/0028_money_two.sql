CREATE TYPE "public"."credit_reason" AS ENUM('rainout_rebate', 'referral', 'goodwill', 'spent', 'released');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'credited');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'offered', 'accepted', 'expired', 'left');--> statement-breakpoint
CREATE TABLE "credit_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta_cents" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"purchase_id" uuid,
	"rebate_id" uuid,
	"referral_id" uuid,
	"note" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_entry_sign" CHECK (("credit_entry"."reason" = 'spent' and "credit_entry"."delta_cents" < 0) or ("credit_entry"."reason" <> 'spent' and "credit_entry"."delta_cents" > 0)),
	CONSTRAINT "credit_entry_source" CHECK (("credit_entry"."reason" in ('spent', 'released')) = ("credit_entry"."purchase_id" is not null) and ("credit_entry"."reason" = 'rainout_rebate') = ("credit_entry"."rebate_id" is not null) and ("credit_entry"."reason" = 'referral') = ("credit_entry"."referral_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "referral" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"status" "referral_status" DEFAULT 'pending' NOT NULL,
	"credited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_referred_once" UNIQUE("referred_user_id"),
	CONSTRAINT "referral_not_self" CHECK ("referral"."referrer_user_id" <> "referral"."referred_user_id"),
	CONSTRAINT "referral_credited_has_time" CHECK (("referral"."status" = 'credited') = ("referral"."credited_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "referral_code" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_code_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "season_rebate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"games_count" integer NOT NULL,
	"games_lost" integer NOT NULL,
	"paid_cents" integer NOT NULL,
	"rebate_cents" integer NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_rebate_team_once" UNIQUE("team_season_id"),
	CONSTRAINT "season_rebate_numbers" CHECK ("season_rebate"."games_count" > 0 and "season_rebate"."games_lost" between 1 and "season_rebate"."games_count" and "season_rebate"."paid_cents" >= 0 and "season_rebate"."rebate_cents" > 0 and "season_rebate"."rebate_cents" <= "season_rebate"."paid_cents")
);
--> statement-breakpoint
CREATE TABLE "saved_payment_method" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"stripe_setup_session_id" text NOT NULL,
	"brand" text,
	"last4" text,
	"warned_for_deadline" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"charge_purchase_id" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_payment_method_warning" CHECK (("saved_payment_method"."warned_at" is null) = ("saved_payment_method"."warned_for_deadline" is null))
);
--> statement-breakpoint
CREATE TABLE "waitlist_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_name" text,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entry_offer_times" CHECK (("waitlist_entry"."offered_at" is null) = ("waitlist_entry"."offer_expires_at" is null) and ("waitlist_entry"."status" <> 'offered' or "waitlist_entry"."offer_expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_rebate_id_season_rebate_id_fk" FOREIGN KEY ("rebate_id") REFERENCES "public"."season_rebate"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_referral_id_referral_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referral"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referrer_user_id_user_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referred_user_id_user_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_code" ADD CONSTRAINT "referral_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rebate" ADD CONSTRAINT "season_rebate_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rebate" ADD CONSTRAINT "season_rebate_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rebate" ADD CONSTRAINT "season_rebate_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payment_method" ADD CONSTRAINT "saved_payment_method_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payment_method" ADD CONSTRAINT "saved_payment_method_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_payment_method" ADD CONSTRAINT "saved_payment_method_charge_purchase_id_purchase_id_fk" FOREIGN KEY ("charge_purchase_id") REFERENCES "public"."purchase"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_entry_user_idx" ON "credit_entry" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entry_purchase_reason_once" ON "credit_entry" USING btree ("purchase_id","reason") WHERE "credit_entry"."purchase_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entry_rebate_user_once" ON "credit_entry" USING btree ("rebate_id","user_id") WHERE "credit_entry"."rebate_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entry_referral_once" ON "credit_entry" USING btree ("referral_id") WHERE "credit_entry"."referral_id" is not null;--> statement-breakpoint
CREATE INDEX "referral_referrer_idx" ON "referral" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "season_rebate_season_idx" ON "season_rebate" USING btree ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_payment_method_session_unique" ON "saved_payment_method" USING btree ("stripe_setup_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_payment_method_one_per_team" ON "saved_payment_method" USING btree ("team_season_id") WHERE "saved_payment_method"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "saved_payment_method_user_idx" ON "saved_payment_method" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entry_one_open" ON "waitlist_entry" USING btree ("season_id","user_id") WHERE "waitlist_entry"."status" in ('waiting', 'offered');--> statement-breakpoint
CREATE INDEX "waitlist_entry_season_status_idx" ON "waitlist_entry" USING btree ("season_id","status","created_at");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_payment_intent_unique" UNIQUE("stripe_payment_intent_id");