CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid,
	"season_id" uuid NOT NULL,
	"team_season_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"recipient_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_text_lengths" CHECK (char_length("announcement"."subject") between 1 and 120 and char_length("announcement"."body") between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" "message_topic" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_once" UNIQUE("user_id","topic","channel")
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "announcement_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_season_idx" ON "announcement" USING btree ("season_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcement_author_idx" ON "announcement" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_announcement_idx" ON "message" USING btree ("announcement_id");