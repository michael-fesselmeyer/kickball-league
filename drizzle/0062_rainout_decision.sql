CREATE TYPE "public"."weather_part" AS ENUM('forecast', 'observed', 'alerts');--> statement-breakpoint
CREATE TABLE "weather_snapshot" (
	"place" text NOT NULL,
	"part" "weather_part" NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weather_snapshot_place_part_pk" PRIMARY KEY("place","part")
);
--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "admins_confirm_rainouts" boolean DEFAULT false NOT NULL;