CREATE TABLE "division" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"rule_set_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "division_season_slug_unique" UNIQUE("season_id","slug"),
	CONSTRAINT "division_season_name_unique" UNIQUE("season_id","name"),
	CONSTRAINT "division_id_season_unique" UNIQUE("id","season_id"),
	CONSTRAINT "division_slug_format" CHECK ("division"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "rule_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"innings" integer,
	"time_limit_minutes" integer,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "rule_set_league_name_unique" UNIQUE("league_id","name"),
	CONSTRAINT "rule_set_innings_range" CHECK ("rule_set"."innings" is null or "rule_set"."innings" between 1 and 15),
	CONSTRAINT "rule_set_time_limit_range" CHECK ("rule_set"."time_limit_minutes" is null or "rule_set"."time_limit_minutes" between 10 and 240)
);
--> statement-breakpoint
ALTER TABLE "bracket" DROP CONSTRAINT "bracket_season_unique";--> statement-breakpoint
ALTER TABLE "bracket" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "crossover_games" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "crossovers_count" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "combined_final" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "team_season" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_rule_set_id_rule_set_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_set"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "division" ADD CONSTRAINT "division_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "division_season_order_idx" ON "division" USING btree ("season_id","sort_order");--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_division_id_division_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_division_fk" FOREIGN KEY ("division_id","season_id") REFERENCES "public"."division"("id","season_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_season_division_idx" ON "team_season" USING btree ("division_id");--> statement-breakpoint
ALTER TABLE "bracket" ADD CONSTRAINT "bracket_season_division_unique" UNIQUE NULLS NOT DISTINCT("season_id","division_id");--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_crossover_games_range" CHECK ("season"."crossover_games" between 0 and 10);