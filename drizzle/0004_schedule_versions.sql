CREATE TYPE "public"."permit_window_status" AS ENUM('requested', 'confirmed', 'lost');--> statement-breakpoint
CREATE TYPE "public"."schedule_version_origin" AS ENUM('generated', 'manual_edit', 'rainout', 'playoffs');--> statement-breakpoint
CREATE TYPE "public"."schedule_version_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."team_constraint_kind" AS ENUM('unavailable', 'prefer', 'avoid');--> statement-breakpoint
CREATE TABLE "blackout" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"field_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "blackout_season_date_field_unique" UNIQUE NULLS NOT DISTINCT("season_id","on_date","field_id")
);
--> statement-breakpoint
CREATE TABLE "game_placement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_version_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"slot_id" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_placement_version_game_unique" UNIQUE("schedule_version_id","game_id"),
	CONSTRAINT "game_placement_locked_has_slot" CHECK (not "game_placement"."locked" or "game_placement"."slot_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "permit_window" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"permit_number" text,
	"status" "permit_window_status" DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "permit_window_times_order" CHECK ("permit_window"."ends_at" > "permit_window"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"parent_version_id" uuid,
	"status" "schedule_version_status" DEFAULT 'draft' NOT NULL,
	"origin" "schedule_version_origin" NOT NULL,
	"seed" bigint,
	"input_snapshot" jsonb NOT NULL,
	"metrics" jsonb,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "schedule_version_season_no_unique" UNIQUE("season_id","version_no"),
	CONSTRAINT "schedule_version_no_positive" CHECK ("schedule_version"."version_no" > 0),
	CONSTRAINT "schedule_version_published_has_time" CHECK ("schedule_version"."status" = 'draft' or "schedule_version"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "team_constraint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_season_id" uuid NOT NULL,
	"kind" "team_constraint_kind" NOT NULL,
	"on_date" date,
	"time_index" integer,
	"weight" integer DEFAULT 1 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "team_constraint_has_date_or_time" CHECK ("team_constraint"."on_date" is not null or "team_constraint"."time_index" is not null),
	CONSTRAINT "team_constraint_time_index_non_negative" CHECK ("team_constraint"."time_index" is null or "team_constraint"."time_index" >= 0),
	CONSTRAINT "team_constraint_weight_range" CHECK ("team_constraint"."weight" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "slot" ADD COLUMN "permit_window_id" uuid;--> statement-breakpoint
ALTER TABLE "blackout" ADD CONSTRAINT "blackout_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackout" ADD CONSTRAINT "blackout_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackout" ADD CONSTRAINT "blackout_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_placement" ADD CONSTRAINT "game_placement_schedule_version_id_schedule_version_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "public"."schedule_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_placement" ADD CONSTRAINT "game_placement_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_placement" ADD CONSTRAINT "game_placement_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_parent_version_id_schedule_version_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."schedule_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_version" ADD CONSTRAINT "schedule_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_constraint" ADD CONSTRAINT "team_constraint_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_constraint" ADD CONSTRAINT "team_constraint_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_placement_version_slot_unique" ON "game_placement" USING btree ("schedule_version_id","slot_id") WHERE "game_placement"."slot_id" is not null;--> statement-breakpoint
CREATE INDEX "permit_window_season_idx" ON "permit_window" USING btree ("season_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_version_one_published" ON "schedule_version" USING btree ("season_id") WHERE "schedule_version"."status" = 'published';--> statement-breakpoint
CREATE INDEX "team_constraint_team_idx" ON "team_constraint" USING btree ("team_season_id");--> statement-breakpoint
ALTER TABLE "slot" ADD CONSTRAINT "slot_permit_window_id_permit_window_id_fk" FOREIGN KEY ("permit_window_id") REFERENCES "public"."permit_window"("id") ON DELETE restrict ON UPDATE no action;