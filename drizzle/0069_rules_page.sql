CREATE TABLE "rule_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb NOT NULL,
	"effective_on" date NOT NULL,
	"notice" boolean DEFAULT false NOT NULL,
	"notice_recipients" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "rule_change_summary_length" CHECK (char_length("rule_change"."summary") between 1 and 200),
	CONSTRAINT "rule_change_has_changes" CHECK (jsonb_typeof("rule_change"."changes") = 'array' and jsonb_array_length("rule_change"."changes") > 0)
);
--> statement-breakpoint
CREATE TABLE "rule_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_section_league_slug" UNIQUE("league_id","slug"),
	CONSTRAINT "rule_section_title_length" CHECK (char_length("rule_section"."title") between 1 and 80),
	CONSTRAINT "rule_section_body_length" CHECK (char_length("rule_section"."body") between 1 and 20000),
	CONSTRAINT "rule_section_slug_format" CHECK ("rule_section"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "rule_change" ADD CONSTRAINT "rule_change_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_change" ADD CONSTRAINT "rule_change_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_section" ADD CONSTRAINT "rule_section_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_change_league_created_idx" ON "rule_change" USING btree ("league_id","created_at");