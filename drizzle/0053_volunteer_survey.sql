CREATE TYPE "public"."survey_return" AS ENUM('yes', 'maybe', 'no');--> statement-breakpoint
CREATE TYPE "public"."volunteer_role" AS ENUM('setup', 'teardown', 'check_in', 'ref_fill_in');--> statement-breakpoint
CREATE TABLE "season_survey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"opened_by" uuid,
	CONSTRAINT "season_survey_one_per_season" UNIQUE("season_id"),
	CONSTRAINT "season_survey_closed_after_open" CHECK ("season_survey"."closed_at" is null or "season_survey"."closed_at" >= "season_survey"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "survey_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"would_return" "survey_return" NOT NULL,
	"best_part" text,
	"one_change" text,
	"comment" text,
	CONSTRAINT "survey_answer_rating" CHECK ("survey_answer"."rating" between 1 and 5),
	CONSTRAINT "survey_answer_best_part_length" CHECK ("survey_answer"."best_part" is null or char_length("survey_answer"."best_part") between 1 and 500),
	CONSTRAINT "survey_answer_one_change_length" CHECK ("survey_answer"."one_change" is null or char_length("survey_answer"."one_change") between 1 and 500),
	CONSTRAINT "survey_answer_comment_length" CHECK ("survey_answer"."comment" is null or char_length("survey_answer"."comment") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "survey_response_once" UNIQUE("survey_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "volunteer_shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"role" "volunteer_role" NOT NULL,
	"season_id" uuid,
	"event_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"place" text,
	"notes" text DEFAULT '' NOT NULL,
	"spots" smallint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_shift_one_occasion" CHECK (("volunteer_shift"."season_id" is null) <> ("volunteer_shift"."event_id" is null)),
	CONSTRAINT "volunteer_shift_ends_after_start" CHECK ("volunteer_shift"."ends_at" > "volunteer_shift"."starts_at"),
	CONSTRAINT "volunteer_shift_spots" CHECK ("volunteer_shift"."spots" between 1 and 50),
	CONSTRAINT "volunteer_shift_place_length" CHECK ("volunteer_shift"."place" is null or char_length("volunteer_shift"."place") between 1 and 120),
	CONSTRAINT "volunteer_shift_notes_length" CHECK (char_length("volunteer_shift"."notes") <= 500)
);
--> statement-breakpoint
CREATE TABLE "volunteer_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_signup_once" UNIQUE("shift_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "season_survey" ADD CONSTRAINT "season_survey_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_survey" ADD CONSTRAINT "season_survey_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_answer" ADD CONSTRAINT "survey_answer_survey_id_season_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."season_survey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_survey_id_season_survey_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."season_survey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift" ADD CONSTRAINT "volunteer_shift_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift" ADD CONSTRAINT "volunteer_shift_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift" ADD CONSTRAINT "volunteer_shift_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift" ADD CONSTRAINT "volunteer_shift_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_signup" ADD CONSTRAINT "volunteer_signup_shift_id_volunteer_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."volunteer_shift"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_signup" ADD CONSTRAINT "volunteer_signup_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_answer_survey_idx" ON "survey_answer" USING btree ("survey_id");--> statement-breakpoint
CREATE INDEX "volunteer_shift_league_starts_idx" ON "volunteer_shift" USING btree ("league_id","starts_at");--> statement-breakpoint
CREATE INDEX "volunteer_shift_season_idx" ON "volunteer_shift" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "volunteer_shift_event_idx" ON "volunteer_shift" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "volunteer_signup_user_idx" ON "volunteer_signup" USING btree ("user_id");