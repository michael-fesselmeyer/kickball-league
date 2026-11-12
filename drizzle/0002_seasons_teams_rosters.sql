CREATE TYPE "public"."season_fee_model" AS ENUM('per_team', 'per_player');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('draft', 'registration_open', 'registration_closed', 'in_progress', 'playoffs', 'completed');--> statement-breakpoint
CREATE TYPE "public"."registration_kind" AS ENUM('team_member', 'free_agent');--> statement-breakpoint
CREATE TYPE "public"."registration_shirt_status" AS ENUM('none', 'ordered', 'received');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending_waiver', 'pending_payment', 'active', 'waitlisted', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."roster_membership_role" AS ENUM('captain', 'co_captain', 'player');--> statement-breakpoint
CREATE TYPE "public"."roster_membership_status" AS ENUM('invited', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."team_season_payment_mode" AS ENUM('full', 'split');--> statement-breakpoint
CREATE TYPE "public"."team_season_status" AS ENUM('forming', 'pending_payment', 'confirmed', 'waitlisted', 'withdrawn');--> statement-breakpoint
CREATE TABLE "season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "season_status" DEFAULT 'draft' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"payment_deadline_at" timestamp with time zone,
	"fee_model" "season_fee_model" NOT NULL,
	"team_fee_cents" integer,
	"player_fee_cents" integer,
	"free_agent_fee_cents" integer,
	"early_bird_ends_at" timestamp with time zone,
	"early_bird_discount_cents" integer,
	"max_teams" integer,
	"roster_min" integer NOT NULL,
	"roster_max" integer NOT NULL,
	"games_per_team_per_day" integer DEFAULT 1 NOT NULL,
	"fielding_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tiebreakers" jsonb DEFAULT '["win_pct","head_to_head","run_difference","runs_allowed","coin_flip"]'::jsonb NOT NULL,
	"rebate_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "season_league_slug_unique" UNIQUE("league_id","slug"),
	CONSTRAINT "season_dates_order" CHECK ("season"."ends_on" >= "season"."starts_on"),
	CONSTRAINT "season_roster_limits" CHECK ("season"."roster_min" > 0 and "season"."roster_max" >= "season"."roster_min"),
	CONSTRAINT "season_games_per_day" CHECK ("season"."games_per_team_per_day" in (1, 2)),
	CONSTRAINT "season_fees_non_negative" CHECK (coalesce("season"."team_fee_cents", 0) >= 0 and coalesce("season"."player_fee_cents", 0) >= 0 and coalesce("season"."free_agent_fee_cents", 0) >= 0 and coalesce("season"."early_bird_discount_cents", 0) >= 0),
	CONSTRAINT "season_fee_matches_model" CHECK (("season"."fee_model" = 'per_team' and "season"."team_fee_cents" is not null) or ("season"."fee_model" = 'per_player' and "season"."player_fee_cents" is not null)),
	CONSTRAINT "season_registration_window" CHECK ("season"."registration_closes_at" is null or "season"."registration_opens_at" is null or "season"."registration_closes_at" > "season"."registration_opens_at")
);
--> statement-breakpoint
CREATE TABLE "registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "registration_kind" NOT NULL,
	"status" "registration_status" DEFAULT 'pending_waiver' NOT NULL,
	"shirt_status" "registration_shirt_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "registration_season_user_unique" UNIQUE("season_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "roster_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_season_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"role" "roster_membership_role" DEFAULT 'player' NOT NULL,
	"status" "roster_membership_status" DEFAULT 'invited' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"shares_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "roster_membership_dates_order" CHECK ("roster_membership"."ended_at" is null or "roster_membership"."started_at" is null or "roster_membership"."ended_at" >= "roster_membership"."started_at")
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color_hex" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "team_league_slug_unique" UNIQUE("league_id","slug"),
	CONSTRAINT "team_slug_format" CHECK ("team"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "team_color_hex" CHECK ("team"."color_hex" is null or "team"."color_hex" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "team_season" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"status" "team_season_status" DEFAULT 'forming' NOT NULL,
	"payment_mode" "team_season_payment_mode" DEFAULT 'full' NOT NULL,
	"share_cents" integer,
	"target_roster_size" integer,
	"seed" integer,
	"vibe" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "team_season_team_season_unique" UNIQUE("team_id","season_id"),
	CONSTRAINT "team_season_share_non_negative" CHECK ("team_season"."share_cents" is null or "team_season"."share_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_membership" ADD CONSTRAINT "roster_membership_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_membership" ADD CONSTRAINT "roster_membership_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_membership" ADD CONSTRAINT "roster_membership_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "season_league_starts_idx" ON "season" USING btree ("league_id","starts_on");--> statement-breakpoint
CREATE INDEX "registration_season_status_idx" ON "registration" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "registration_user_idx" ON "registration" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_membership_spot_unique" ON "roster_membership" USING btree ("team_season_id","registration_id") WHERE "roster_membership"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "roster_membership_one_active_team" ON "roster_membership" USING btree ("registration_id") WHERE "roster_membership"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "roster_membership_one_captain" ON "roster_membership" USING btree ("team_season_id") WHERE "roster_membership"."role" = 'captain' and "roster_membership"."status" = 'active';--> statement-breakpoint
CREATE INDEX "roster_membership_team_status_idx" ON "roster_membership" USING btree ("team_season_id","status");--> statement-breakpoint
CREATE INDEX "team_season_season_status_idx" ON "team_season" USING btree ("season_id","status");