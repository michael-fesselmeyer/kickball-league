CREATE TABLE "away_week" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "away_week_once" UNIQUE("registration_id","week_start"),
	CONSTRAINT "away_week_monday" CHECK (extract(isodow from "away_week"."week_start") = 1)
);
--> statement-breakpoint
ALTER TABLE "away_week" ADD CONSTRAINT "away_week_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "away_week_week_idx" ON "away_week" USING btree ("week_start");