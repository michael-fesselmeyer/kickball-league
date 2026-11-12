CREATE TABLE "waiver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"body_sha256" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "waiver_league_version_unique" UNIQUE("league_id","version"),
	CONSTRAINT "waiver_version_positive" CHECK ("waiver"."version" > 0),
	CONSTRAINT "waiver_sha256_format" CHECK ("waiver"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "waiver_signature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waiver_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"signed_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"body_sha256" text NOT NULL,
	CONSTRAINT "waiver_signature_once" UNIQUE("waiver_id","user_id","season_id"),
	CONSTRAINT "waiver_signature_name" CHECK (length(trim("waiver_signature"."signed_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "waiver_id" uuid;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "waiver_signature_id" uuid;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver" ADD CONSTRAINT "waiver_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD CONSTRAINT "waiver_signature_waiver_id_waiver_id_fk" FOREIGN KEY ("waiver_id") REFERENCES "public"."waiver"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD CONSTRAINT "waiver_signature_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD CONSTRAINT "waiver_signature_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_signature_user_idx" ON "waiver_signature" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_waiver_id_waiver_id_fk" FOREIGN KEY ("waiver_id") REFERENCES "public"."waiver"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_waiver_signature_id_waiver_signature_id_fk" FOREIGN KEY ("waiver_signature_id") REFERENCES "public"."waiver_signature"("id") ON DELETE restrict ON UPDATE no action;