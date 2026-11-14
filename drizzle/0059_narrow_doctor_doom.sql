ALTER TABLE "team_keep_off" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD COLUMN "email" text;--> statement-breakpoint
CREATE INDEX "team_keep_off_pending_email_idx" ON "team_keep_off" USING btree ("email") WHERE "team_keep_off"."user_id" is null;--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD CONSTRAINT "team_keep_off_address_once" UNIQUE("team_id","email");--> statement-breakpoint
ALTER TABLE "team_keep_off" ADD CONSTRAINT "team_keep_off_who" CHECK ("team_keep_off"."user_id" is not null or "team_keep_off"."email" is not null);