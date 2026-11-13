CREATE TABLE "team_keep_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_keep_off_once" UNIQUE("team_id","user_id"),
	CONSTRAINT "team_keep_off_reason_length" CHECK ("team_keep_off"."reason" is null or char_length("team_keep_off"."reason") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "export_keep_off_entries" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD CONSTRAINT "team_keep_off_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD CONSTRAINT "team_keep_off_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD CONSTRAINT "team_keep_off_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_keep_off_user_idx" ON "team_keep_off" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_keep_off_added_by_idx" ON "team_keep_off" USING btree ("added_by");