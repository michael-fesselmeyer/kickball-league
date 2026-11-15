CREATE TYPE "public"."shirt_order_status" AS ENUM('not_placed', 'placed', 'received');--> statement-breakpoint
ALTER TYPE "public"."profile_shirt_size" ADD VALUE 'xxxl';--> statement-breakpoint
CREATE TABLE "season_shirts" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"sizes" "profile_shirt_size"[] DEFAULT '{xs,s,m,l,xl,xxl}'::profile_shirt_size[] NOT NULL,
	"status" "shirt_order_status" DEFAULT 'not_placed' NOT NULL,
	"placed_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cost_cents" integer,
	"vendor" text,
	"expense_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_shirts_sizes" CHECK (cardinality("season_shirts"."sizes") >= 1),
	CONSTRAINT "season_shirts_cost" CHECK ("season_shirts"."cost_cents" is null or "season_shirts"."cost_cents" between 1 and 10000000),
	CONSTRAINT "season_shirts_vendor" CHECK ("season_shirts"."vendor" is null or length("season_shirts"."vendor") <= 80),
	CONSTRAINT "season_shirts_status" CHECK (("season_shirts"."status" = 'not_placed') = ("season_shirts"."placed_at" is null) and ("season_shirts"."status" = 'received') = ("season_shirts"."received_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "season_shirts" ADD CONSTRAINT "season_shirts_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_shirts" ADD CONSTRAINT "season_shirts_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_shirts" ADD CONSTRAINT "season_shirts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_shirts_expense" ON "season_shirts" USING btree ("expense_id");