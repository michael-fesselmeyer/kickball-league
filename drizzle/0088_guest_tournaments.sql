CREATE TABLE "guest_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"captain_name" text NOT NULL,
	"captain_email" text NOT NULL,
	"roster_size" integer NOT NULL,
	"link_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_team_name_length" CHECK (char_length("guest_team"."name") between 1 and 60),
	CONSTRAINT "guest_team_captain_length" CHECK (char_length("guest_team"."captain_name") between 1 and 80 and char_length("guest_team"."captain_email") between 3 and 254),
	CONSTRAINT "guest_team_roster_size" CHECK ("guest_team"."roster_size" between 4 and 30)
);
--> statement-breakpoint
CREATE TABLE "guest_waiver_signature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_team_id" uuid NOT NULL,
	"waiver_id" uuid NOT NULL,
	"signed_name" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body_sha256" text NOT NULL,
	CONSTRAINT "guest_waiver_signature_name_length" CHECK (char_length("guest_waiver_signature"."signed_name") between 3 and 80),
	CONSTRAINT "guest_waiver_signature_sha256" CHECK ("guest_waiver_signature"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "tournament" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"guest_signups_open" boolean DEFAULT true NOT NULL,
	"max_guest_teams" integer,
	"partner_friend_league_id" uuid,
	"charity_name" text,
	"charity_url" text,
	"charity_goal_cents" integer,
	"guest_data_days" integer DEFAULT 30 NOT NULL,
	"guest_data_deleted_at" timestamp with time zone,
	"bracket" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_max_guest_teams" CHECK ("tournament"."max_guest_teams" is null or "tournament"."max_guest_teams" between 1 and 32),
	CONSTRAINT "tournament_guest_data_days" CHECK ("tournament"."guest_data_days" between 1 and 90),
	CONSTRAINT "tournament_charity_pair" CHECK (("tournament"."charity_name" is null) = ("tournament"."charity_url" is null)),
	CONSTRAINT "tournament_charity_url_https" CHECK ("tournament"."charity_url" is null or ("tournament"."charity_url" ~ '^https://' and char_length("tournament"."charity_url") <= 300)),
	CONSTRAINT "tournament_charity_name_length" CHECK ("tournament"."charity_name" is null or char_length("tournament"."charity_name") between 1 and 80),
	CONSTRAINT "tournament_charity_goal" CHECK ("tournament"."charity_goal_cents" is null or ("tournament"."charity_url" is not null and "tournament"."charity_goal_cents" between 100 and 100000000))
);
--> statement-breakpoint
ALTER TABLE "guest_team" ADD CONSTRAINT "guest_team_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_waiver_signature" ADD CONSTRAINT "guest_waiver_signature_guest_team_id_guest_team_id_fk" FOREIGN KEY ("guest_team_id") REFERENCES "public"."guest_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_waiver_signature" ADD CONSTRAINT "guest_waiver_signature_waiver_id_waiver_id_fk" FOREIGN KEY ("waiver_id") REFERENCES "public"."waiver"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_partner_friend_league_id_friend_league_id_fk" FOREIGN KEY ("partner_friend_league_id") REFERENCES "public"."friend_league"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_team_name_unique" ON "guest_team" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "guest_team_token_unique" ON "guest_team" USING btree ("link_token");--> statement-breakpoint
CREATE INDEX "guest_team_event_idx" ON "guest_team" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_waiver_signature_once" ON "guest_waiver_signature" USING btree ("guest_team_id",lower("signed_name"));