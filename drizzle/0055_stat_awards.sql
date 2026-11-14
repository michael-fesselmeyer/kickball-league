CREATE TYPE "public"."stat_award_kind" AS ENUM('season_mvp', 'iron_kicker', 'golden_boot', 'best_teammate', 'rookie_of_the_year', 'sub_of_the_year');--> statement-breakpoint
CREATE TABLE "leaderboard_opt_out" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_award_place" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"award" "stat_award_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid,
	"place" smallint NOT NULL,
	"value" double precision NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "stat_award_place_once" UNIQUE("season_id","award","user_id"),
	CONSTRAINT "stat_award_place_range" CHECK ("stat_award_place"."place" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "stat_award_set" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"weights" jsonb NOT NULL,
	"unused_parts" text[] DEFAULT '{}'::text[] NOT NULL,
	"votes_counted" boolean DEFAULT false NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"computed_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "stat_award_set_published_after_computed" CHECK ("stat_award_set"."published_at" is null or "stat_award_set"."published_at" >= "stat_award_set"."computed_at")
);
--> statement-breakpoint
ALTER TABLE "leaderboard_opt_out" ADD CONSTRAINT "leaderboard_opt_out_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_place" ADD CONSTRAINT "stat_award_place_season_id_stat_award_set_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."stat_award_set"("season_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_place" ADD CONSTRAINT "stat_award_place_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_place" ADD CONSTRAINT "stat_award_place_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_set" ADD CONSTRAINT "stat_award_set_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_set" ADD CONSTRAINT "stat_award_set_computed_by_user_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stat_award_set" ADD CONSTRAINT "stat_award_set_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stat_award_place_user_idx" ON "stat_award_place" USING btree ("user_id");