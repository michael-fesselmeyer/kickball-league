CREATE TABLE "free_agent_profile" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"answers" jsonb NOT NULL,
	"skill_score" integer NOT NULL,
	"vibe_score" integer NOT NULL,
	"would_captain" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_agent_profile_skill_range" CHECK ("free_agent_profile"."skill_score" between 1 and 5),
	CONSTRAINT "free_agent_profile_vibe_range" CHECK ("free_agent_profile"."vibe_score" between 1 and 5),
	CONSTRAINT "free_agent_profile_notes_length" CHECK ("free_agent_profile"."notes" is null or char_length("free_agent_profile"."notes") <= 200)
);
--> statement-breakpoint
CREATE TABLE "friend_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "friend_group_code_unique" UNIQUE("code"),
	CONSTRAINT "friend_group_code_format" CHECK ("friend_group"."code" ~ '^[A-Z2-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "friend_group_id" uuid;--> statement-breakpoint
ALTER TABLE "free_agent_profile" ADD CONSTRAINT "free_agent_profile_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_group" ADD CONSTRAINT "friend_group_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_group" ADD CONSTRAINT "friend_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_group_season_idx" ON "friend_group" USING btree ("season_id");--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_friend_group_id_friend_group_id_fk" FOREIGN KEY ("friend_group_id") REFERENCES "public"."friend_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_friend_group_idx" ON "registration" USING btree ("friend_group_id");