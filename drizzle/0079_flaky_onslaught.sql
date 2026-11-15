CREATE TABLE "conduct_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body_sha256" text NOT NULL,
	CONSTRAINT "conduct_acceptance_once" UNIQUE("code_id","user_id"),
	CONSTRAINT "conduct_acceptance_sha256_format" CHECK ("conduct_acceptance"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "conduct_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"body_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "conduct_code_league_version_unique" UNIQUE("league_id","version"),
	CONSTRAINT "conduct_code_version_positive" CHECK ("conduct_code"."version" > 0),
	CONSTRAINT "conduct_code_sha256_format" CHECK ("conduct_code"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "conduct_acceptance" ADD CONSTRAINT "conduct_acceptance_code_id_conduct_code_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."conduct_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_acceptance" ADD CONSTRAINT "conduct_acceptance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_acceptance" ADD CONSTRAINT "conduct_acceptance_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_code" ADD CONSTRAINT "conduct_code_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conduct_code" ADD CONSTRAINT "conduct_code_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conduct_acceptance_user_idx" ON "conduct_acceptance" USING btree ("user_id");