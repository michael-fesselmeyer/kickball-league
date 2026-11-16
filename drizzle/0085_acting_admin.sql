CREATE TABLE "acting_admin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"powers" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"granted_by" uuid,
	"start_notice_at" timestamp with time zone,
	"end_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acting_admin_dates" CHECK ("acting_admin"."ends_at" > "acting_admin"."starts_at"),
	CONSTRAINT "acting_admin_has_powers" CHECK (cardinality("acting_admin"."powers") > 0)
);
--> statement-breakpoint
ALTER TABLE "acting_admin" ADD CONSTRAINT "acting_admin_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acting_admin" ADD CONSTRAINT "acting_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acting_admin" ADD CONSTRAINT "acting_admin_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acting_admin_user_idx" ON "acting_admin" USING btree ("user_id","league_id");--> statement-breakpoint
CREATE INDEX "acting_admin_league_idx" ON "acting_admin" USING btree ("league_id","ends_at" DESC NULLS LAST);