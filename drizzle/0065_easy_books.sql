CREATE TYPE "public"."recurring_cadence" AS ENUM('season', 'game_day');--> statement-breakpoint
CREATE TABLE "merchant_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"category" "expense_category" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_rule_pattern" UNIQUE("league_id","pattern"),
	CONSTRAINT "merchant_rule_pattern_length" CHECK (char_length("merchant_rule"."pattern") between 2 and 60)
);
--> statement-breakpoint
CREATE TABLE "recurring_cost" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"label" text NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount_cents" integer NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"starts_on" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cost_amount" CHECK ("recurring_cost"."amount_cents" > 0),
	CONSTRAINT "recurring_cost_label" CHECK (char_length("recurring_cost"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "recurring_cost_skip" (
	"recurring_cost_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"skipped_by" uuid,
	"skipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_cost_skip_recurring_cost_id_season_id_due_on_pk" PRIMARY KEY("recurring_cost_id","season_id","due_on")
);
--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "no_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "paid_by" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "reimbursed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "reimbursed_by" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "recurring_cost_id" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rule" ADD CONSTRAINT "merchant_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cost" ADD CONSTRAINT "recurring_cost_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cost" ADD CONSTRAINT "recurring_cost_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cost_skip" ADD CONSTRAINT "recurring_cost_skip_recurring_cost_id_recurring_cost_id_fk" FOREIGN KEY ("recurring_cost_id") REFERENCES "public"."recurring_cost"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cost_skip" ADD CONSTRAINT "recurring_cost_skip_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_cost_skip" ADD CONSTRAINT "recurring_cost_skip_skipped_by_user_id_fk" FOREIGN KEY ("skipped_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_cost_league" ON "recurring_cost" USING btree ("league_id");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_reimbursed_by_user_id_fk" FOREIGN KEY ("reimbursed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_recurring_cost_id_recurring_cost_id_fk" FOREIGN KEY ("recurring_cost_id") REFERENCES "public"."recurring_cost"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_paid_by" ON "expense" USING btree ("paid_by") WHERE "expense"."reimbursed_at" is null;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_occurrence" UNIQUE("recurring_cost_id","season_id","due_on");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_import_key" UNIQUE("season_id","import_key");--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_no_receipt" CHECK (not ("expense"."no_receipt" and "expense"."receipt_file_id" is not null));