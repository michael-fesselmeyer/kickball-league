CREATE TYPE "public"."field_check_kind" AS ENUM('setup', 'close');--> statement-breakpoint
CREATE TYPE "public"."field_check_status" AS ENUM('ok', 'problem');--> statement-breakpoint
CREATE TYPE "public"."game_checklist_phase" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TYPE "public"."move_outcome" AS ENUM('fine', 'refused', 'complaint');--> statement-breakpoint
ALTER TYPE "public"."books_file_kind" ADD VALUE 'field_photo';--> statement-breakpoint
ALTER TYPE "public"."volunteer_role" ADD VALUE 'setup_lead';--> statement-breakpoint
CREATE TABLE "field_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "field_check_kind" NOT NULL,
	"status" "field_check_status" NOT NULL,
	"note" text,
	"photo_id" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_check_one_per_day" UNIQUE("field_id","date","kind"),
	CONSTRAINT "field_check_note_length" CHECK ("field_check"."note" is null or char_length("field_check"."note") between 1 and 500),
	CONSTRAINT "field_check_problem_says_why" CHECK ("field_check"."status" = 'ok' or "field_check"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "game_checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"phase" "game_checklist_phase" NOT NULL,
	"text" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_checklist_item_once" UNIQUE("season_id","phase","text"),
	CONSTRAINT "game_checklist_item_text_length" CHECK (char_length("game_checklist_item"."text") between 1 and 140)
);
--> statement-breakpoint
CREATE TABLE "game_checklist_tick" (
	"game_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"ticked_by" uuid,
	"ticked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_checklist_tick_game_id_team_season_id_item_id_pk" PRIMARY KEY("game_id","team_season_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "move_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"outcome" "move_outcome" NOT NULL,
	"note" text,
	"asked_by" uuid,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "move_request_note_length" CHECK ("move_request"."note" is null or char_length("move_request"."note") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "move_script" text;--> statement-breakpoint
ALTER TABLE "field_check" ADD CONSTRAINT "field_check_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_check" ADD CONSTRAINT "field_check_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_check" ADD CONSTRAINT "field_check_photo_id_books_file_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."books_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_check" ADD CONSTRAINT "field_check_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_checklist_item" ADD CONSTRAINT "game_checklist_item_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_checklist_tick" ADD CONSTRAINT "game_checklist_tick_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_checklist_tick" ADD CONSTRAINT "game_checklist_tick_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_checklist_tick" ADD CONSTRAINT "game_checklist_tick_item_id_game_checklist_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."game_checklist_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_checklist_tick" ADD CONSTRAINT "game_checklist_tick_ticked_by_user_id_fk" FOREIGN KEY ("ticked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_request" ADD CONSTRAINT "move_request_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_request" ADD CONSTRAINT "move_request_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "move_request" ADD CONSTRAINT "move_request_asked_by_user_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_check_season_date_idx" ON "field_check" USING btree ("season_id","date");--> statement-breakpoint
CREATE INDEX "field_check_confirmed_by_idx" ON "field_check" USING btree ("confirmed_by");--> statement-breakpoint
CREATE INDEX "field_check_photo_idx" ON "field_check" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "game_checklist_item_season_idx" ON "game_checklist_item" USING btree ("season_id","phase","position");--> statement-breakpoint
CREATE INDEX "game_checklist_tick_item_idx" ON "game_checklist_tick" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "game_checklist_tick_ticked_by_idx" ON "game_checklist_tick" USING btree ("ticked_by");--> statement-breakpoint
CREATE INDEX "move_request_season_idx" ON "move_request" USING btree ("season_id","asked_at");--> statement-breakpoint
CREATE INDEX "move_request_field_idx" ON "move_request" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "move_request_asked_by_idx" ON "move_request" USING btree ("asked_by");--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_move_script_length" CHECK ("season"."move_script" is null or char_length("season"."move_script") between 1 and 600);