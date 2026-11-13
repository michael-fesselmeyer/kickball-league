CREATE TYPE "public"."friend_activity" AS ENUM('softball', 'soccer', 'volleyball', 'basketball', 'dodgeball', 'flag_football', 'ultimate', 'bowling', 'pool', 'darts', 'cornhole', 'tabletop', 'trivia', 'running', 'other');--> statement-breakpoint
CREATE TABLE "friend_league" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"activity" "friend_activity" NOT NULL,
	"area" text,
	"description" text,
	"url" text NOT NULL,
	"links_back" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "friend_league_name_unique" UNIQUE("league_id","name"),
	CONSTRAINT "friend_league_name_length" CHECK (char_length("friend_league"."name") between 1 and 80),
	CONSTRAINT "friend_league_area_length" CHECK ("friend_league"."area" is null or char_length("friend_league"."area") between 1 and 80),
	CONSTRAINT "friend_league_description_length" CHECK ("friend_league"."description" is null or char_length("friend_league"."description") between 1 and 280),
	CONSTRAINT "friend_league_url_https" CHECK ("friend_league"."url" ~ '^https://' and char_length("friend_league"."url") <= 300)
);
--> statement-breakpoint
CREATE TABLE "friend_logo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"friend_league_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_logo_friendLeagueId_unique" UNIQUE("friend_league_id"),
	CONSTRAINT "friend_logo_type" CHECK ("friend_logo"."content_type" in ('image/webp', 'image/png')),
	CONSTRAINT "friend_logo_size" CHECK ("friend_logo"."byte_size" = octet_length("friend_logo"."bytes") and "friend_logo"."byte_size" between 1 and 102400),
	CONSTRAINT "friend_logo_dimensions" CHECK ("friend_logo"."width" between 1 and 192 and "friend_logo"."height" between 1 and 192)
);
--> statement-breakpoint
ALTER TABLE "friend_league" ADD CONSTRAINT "friend_league_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_league" ADD CONSTRAINT "friend_league_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_logo" ADD CONSTRAINT "friend_logo_friend_league_id_friend_league_id_fk" FOREIGN KEY ("friend_league_id") REFERENCES "public"."friend_league"("id") ON DELETE cascade ON UPDATE no action;