CREATE TYPE "public"."referee_payout_method" AS ENUM('cash', 'venmo');--> statement-breakpoint
CREATE TABLE "referee_availability" (
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	CONSTRAINT "referee_availability_season_id_user_id_starts_at_pk" PRIMARY KEY("season_id","user_id","starts_at")
);
--> statement-breakpoint
CREATE TABLE "referee_pay_rate" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"fee_cents" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referee_pay_rate_fee" CHECK ("referee_pay_rate"."fee_cents" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "referee_payout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "referee_payout_method" NOT NULL,
	"paid_on" date NOT NULL,
	"paid_by" uuid,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referee_payout_amount" CHECK ("referee_payout"."amount_cents" between 1 and 100000)
);
--> statement-breakpoint
CREATE TABLE "referee_profile" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referee_profile_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "referee_availability" ADD CONSTRAINT "referee_availability_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_availability" ADD CONSTRAINT "referee_availability_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_pay_rate" ADD CONSTRAINT "referee_pay_rate_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_pay_rate" ADD CONSTRAINT "referee_pay_rate_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_payout" ADD CONSTRAINT "referee_payout_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_payout" ADD CONSTRAINT "referee_payout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_payout" ADD CONSTRAINT "referee_payout_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_payout" ADD CONSTRAINT "referee_payout_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_profile" ADD CONSTRAINT "referee_profile_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referee_availability_user_idx" ON "referee_availability" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referee_pay_rate_updated_by_idx" ON "referee_pay_rate" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "referee_payout_season_user_idx" ON "referee_payout" USING btree ("season_id","user_id");--> statement-breakpoint
CREATE INDEX "referee_payout_user_idx" ON "referee_payout" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referee_payout_paid_by_idx" ON "referee_payout" USING btree ("paid_by");--> statement-breakpoint
CREATE INDEX "referee_payout_expense_idx" ON "referee_payout" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "referee_profile_user_idx" ON "referee_profile" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referee_profile_added_by_idx" ON "referee_profile" USING btree ("added_by");