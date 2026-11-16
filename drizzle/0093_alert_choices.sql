CREATE TYPE "public"."alert_card" AS ENUM('first_rsvp', 'joined_team', 'first_game', 'season_end');--> statement-breakpoint
CREATE TYPE "public"."alert_card_answer" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."preference_source" AS ENUM('settings', 'card', 'email_link');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'rules';--> statement-breakpoint
CREATE TABLE "alert_card_response" (
	"user_id" uuid NOT NULL,
	"card" "alert_card" NOT NULL,
	"answer" "alert_card_answer" NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_card_response_user_id_card_pk" PRIMARY KEY("user_id","card")
);
--> statement-breakpoint
ALTER TABLE "alert_setting" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_setting" ADD COLUMN "team_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_setting" ADD COLUMN "weekly_news" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "changed_via" "preference_source";--> statement-breakpoint
ALTER TABLE "alert_card_response" ADD CONSTRAINT "alert_card_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_card_response_card_idx" ON "alert_card_response" USING btree ("card","answer");--> statement-breakpoint
CREATE INDEX "notification_preference_topic_idx" ON "notification_preference" USING btree ("topic","channel");