CREATE TYPE "public"."digest_frequency" AS ENUM('daily', 'weekly');--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'held';--> statement-breakpoint
ALTER TYPE "public"."message_status" ADD VALUE 'digested';--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'digest';--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'operations';--> statement-breakpoint
CREATE TABLE "alert_setting" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_cap" smallint DEFAULT 3 NOT NULL,
	"digest" "digest_frequency" DEFAULT 'daily' NOT NULL,
	"quiet_start_hour" smallint DEFAULT 22,
	"quiet_end_hour" smallint DEFAULT 8,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_setting_daily_cap" CHECK ("alert_setting"."daily_cap" between 0 and 3),
	CONSTRAINT "alert_setting_quiet_hours" CHECK (("alert_setting"."quiet_start_hour" is null and "alert_setting"."quiet_end_hour" is null) or ("alert_setting"."quiet_start_hour" between 0 and 23 and "alert_setting"."quiet_end_hour" between 0 and 23 and "alert_setting"."quiet_start_hour" <> "alert_setting"."quiet_end_hour"))
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "digest_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_setting" ADD CONSTRAINT "alert_setting_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_digest_id_message_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_status_send_after_idx" ON "message" USING btree ("status","send_after");--> statement-breakpoint
CREATE INDEX "message_digest_idx" ON "message" USING btree ("digest_id");--> statement-breakpoint
CREATE INDEX "message_email_sent_idx" ON "message" USING btree ("sent_at") WHERE "message"."status" = 'sent' and "message"."channel" = 'email';--> statement-breakpoint
CREATE INDEX "message_sent_today_idx" ON "message" USING btree ("user_id","sent_at") WHERE "message"."status" = 'sent';