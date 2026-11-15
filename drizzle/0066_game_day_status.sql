CREATE TYPE "public"."game_day_state" AS ENUM('on', 'watching', 'delayed', 'off');--> statement-breakpoint
ALTER TYPE "public"."message_topic" ADD VALUE 'game_day_watch';--> statement-breakpoint
CREATE TABLE "game_day_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"date" date NOT NULL,
	"state" "game_day_state" NOT NULL,
	"decide_by" timestamp with time zone,
	"reason" text,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_day_status_season_date" UNIQUE("season_id","date"),
	CONSTRAINT "game_day_status_decide_by" CHECK (("game_day_status"."state" = 'watching') = ("game_day_status"."decide_by" is not null)),
	CONSTRAINT "game_day_status_reason_length" CHECK ("game_day_status"."reason" is null or char_length("game_day_status"."reason") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "game_day_status_game" (
	"status_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"new_starts_at" timestamp with time zone,
	CONSTRAINT "game_day_status_game_status_id_game_id_pk" PRIMARY KEY("status_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "game_day_status" ADD CONSTRAINT "game_day_status_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_day_status" ADD CONSTRAINT "game_day_status_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_day_status_game" ADD CONSTRAINT "game_day_status_game_status_id_game_day_status_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."game_day_status"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_day_status_game" ADD CONSTRAINT "game_day_status_game_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_day_status_set_by_idx" ON "game_day_status" USING btree ("set_by");--> statement-breakpoint
CREATE INDEX "game_day_status_game_game_idx" ON "game_day_status_game" USING btree ("game_id");