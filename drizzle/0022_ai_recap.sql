CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_microdollars" integer NOT NULL,
	"outcome" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_feature_format" CHECK ("ai_usage"."feature" ~ '^[a-z_]+$'),
	CONSTRAINT "ai_usage_outcome" CHECK ("ai_usage"."outcome" in ('pending', 'accepted', 'rejected', 'failed')),
	CONSTRAINT "ai_usage_counts" CHECK ("ai_usage"."input_tokens" >= 0 and "ai_usage"."output_tokens" >= 0 and "ai_usage"."cache_read_tokens" >= 0 and "ai_usage"."cache_write_tokens" >= 0 and "ai_usage"."cost_microdollars" >= 0)
);
--> statement-breakpoint
CREATE TABLE "recap_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"day" date NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recap_draft_season_day_key" UNIQUE("season_id","day"),
	CONSTRAINT "recap_draft_lengths" CHECK (char_length("recap_draft"."subject") between 1 and 120 and char_length("recap_draft"."body") between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "ai_monthly_budget_cents" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recap_draft" ADD CONSTRAINT "recap_draft_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recap_draft" ADD CONSTRAINT "recap_draft_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_league_month_idx" ON "ai_usage" USING btree ("league_id","created_at");--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_ai_monthly_budget_range" CHECK ("league"."ai_monthly_budget_cents" between 0 and 100000);