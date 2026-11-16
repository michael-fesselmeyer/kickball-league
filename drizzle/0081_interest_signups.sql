CREATE TYPE "public"."interest_form_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."interest_format" AS ENUM('social', 'competitive');--> statement-breakpoint
CREATE TYPE "public"."interest_night" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');--> statement-breakpoint
CREATE TYPE "public"."interest_response" AS ENUM('yes', 'unsure');--> statement-breakpoint
CREATE TABLE "interest_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"email" text,
	"friends" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_answer_one_per_address" UNIQUE("form_id","email"),
	CONSTRAINT "interest_answer_friends" CHECK ("interest_answer"."friends" is null or "interest_answer"."friends" between 0 and 10),
	CONSTRAINT "interest_answer_email_length" CHECK ("interest_answer"."email" is null or char_length("interest_answer"."email") between 3 and 254)
);
--> statement-breakpoint
CREATE TABLE "interest_choice" (
	"answer_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"response" "interest_response" NOT NULL,
	CONSTRAINT "interest_choice_answer_id_option_id_pk" PRIMARY KEY("answer_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "interest_form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"title" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"status" "interest_form_status" DEFAULT 'open' NOT NULL,
	"teams_needed" smallint DEFAULT 8 NOT NULL,
	"players_per_team" smallint DEFAULT 12 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "interest_form_lengths" CHECK (char_length("interest_form"."title") between 1 and 80 and char_length("interest_form"."intro") <= 600),
	CONSTRAINT "interest_form_target" CHECK ("interest_form"."teams_needed" between 1 and 40 and "interest_form"."players_per_team" between 6 and 25),
	CONSTRAINT "interest_form_closed_at" CHECK (("interest_form"."status" = 'closed') = ("interest_form"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "interest_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"park" text,
	"night" "interest_night",
	"format" "interest_format",
	"position" integer DEFAULT 0 NOT NULL,
	"go_ahead_at" timestamp with time zone,
	"go_ahead_by" uuid,
	"go_ahead_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interest_option_has_a_part" CHECK ("interest_option"."park" is not null or "interest_option"."night" is not null or "interest_option"."format" is not null),
	CONSTRAINT "interest_option_park_length" CHECK ("interest_option"."park" is null or char_length("interest_option"."park") between 1 and 80),
	CONSTRAINT "interest_option_note_length" CHECK ("interest_option"."go_ahead_note" is null or char_length("interest_option"."go_ahead_note") <= 500),
	CONSTRAINT "interest_option_go_ahead_set" CHECK ("interest_option"."go_ahead_note" is null or "interest_option"."go_ahead_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "interest_answer" ADD CONSTRAINT "interest_answer_form_id_interest_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."interest_form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_choice" ADD CONSTRAINT "interest_choice_answer_id_interest_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."interest_answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_choice" ADD CONSTRAINT "interest_choice_option_id_interest_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."interest_option"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_form" ADD CONSTRAINT "interest_form_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_form" ADD CONSTRAINT "interest_form_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_option" ADD CONSTRAINT "interest_option_form_id_interest_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."interest_form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interest_option" ADD CONSTRAINT "interest_option_go_ahead_by_user_id_fk" FOREIGN KEY ("go_ahead_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interest_answer_purge_idx" ON "interest_answer" USING btree ("form_id") WHERE "interest_answer"."email" is not null;--> statement-breakpoint
CREATE INDEX "interest_choice_option_idx" ON "interest_choice" USING btree ("option_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interest_form_one_open" ON "interest_form" USING btree ("league_id") WHERE "interest_form"."status" = 'open';--> statement-breakpoint
CREATE INDEX "interest_form_league_idx" ON "interest_form" USING btree ("league_id","created_at");--> statement-breakpoint
CREATE INDEX "interest_option_form_idx" ON "interest_option" USING btree ("form_id","position");