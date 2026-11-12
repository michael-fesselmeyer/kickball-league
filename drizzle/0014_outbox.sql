CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms', 'push');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."message_topic" AS ENUM('rainout', 'schedule_change', 'game_reminder', 'payment', 'sub_request', 'announcement', 'score', 'events', 'marketing');--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" "message_topic" NOT NULL,
	"channel" "message_channel" DEFAULT 'email' NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"suppress_reason" text,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dedupe_key" text NOT NULL,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "message_attempts_non_negative" CHECK ("message"."attempts" >= 0),
	CONSTRAINT "message_sending_has_lock" CHECK ("message"."status" <> 'sending' or "message"."locked_until" is not null),
	CONSTRAINT "message_suppressed_has_reason" CHECK ("message"."status" <> 'suppressed' or "message"."suppress_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_due_idx" ON "message" USING btree ("send_after") WHERE "message"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "message_user_idx" ON "message" USING btree ("user_id","created_at" DESC NULLS LAST);