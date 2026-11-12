CREATE TABLE "league" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sport" text DEFAULT 'kickball' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_slug_unique" UNIQUE("slug"),
	CONSTRAINT "league_slug_format" CHECK ("league"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
