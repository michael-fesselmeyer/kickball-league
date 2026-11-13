CREATE TYPE "public"."sponsor_kind" AS ENUM('bar', 'restaurant', 'brand', 'other');--> statement-breakpoint
CREATE TABLE "checkin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid,
	"on_date" date NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkin_once_a_day" UNIQUE("sponsor_id","user_id","on_date")
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"terms" text,
	"valid_days" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"valid_from" time,
	"valid_to" time,
	"active" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "deal_title_length" CHECK (char_length("deal"."title") between 1 and 80),
	CONSTRAINT "deal_terms_length" CHECK ("deal"."terms" is null or char_length("deal"."terms") <= 300),
	CONSTRAINT "deal_valid_days_range" CHECK ("deal"."valid_days" <@ '{1,2,3,4,5,6,7}'::smallint[]),
	CONSTRAINT "deal_valid_times_paired" CHECK (("deal"."valid_from" is null) = ("deal"."valid_to" is null))
);
--> statement-breakpoint
CREATE TABLE "deal_redemption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"checkin_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_redemption_once_a_visit" UNIQUE("deal_id","checkin_id")
);
--> statement-breakpoint
CREATE TABLE "sponsor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" "sponsor_kind" DEFAULT 'bar' NOT NULL,
	"is_home_bar" boolean DEFAULT false NOT NULL,
	"blurb" text,
	"address" text,
	"url" text,
	"checkin_secret" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "sponsor_league_slug_unique" UNIQUE("league_id","slug"),
	CONSTRAINT "sponsor_slug_format" CHECK ("sponsor"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "sponsor_name_length" CHECK (char_length("sponsor"."name") between 1 and 80),
	CONSTRAINT "sponsor_blurb_length" CHECK ("sponsor"."blurb" is null or char_length("sponsor"."blurb") <= 500),
	CONSTRAINT "sponsor_url_https" CHECK ("sponsor"."url" is null or "sponsor"."url" ~ '^https://'),
	CONSTRAINT "sponsor_checkin_secret_length" CHECK (char_length("sponsor"."checkin_secret") >= 32)
);
--> statement-breakpoint
CREATE TABLE "sponsor_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sponsor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_member_unique" UNIQUE("sponsor_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_of_week" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"team_season_id" uuid NOT NULL,
	"sponsor_id" uuid,
	"tab_cents" integer,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "team_of_week_one_a_day" UNIQUE("season_id","week_of"),
	CONSTRAINT "team_of_week_tab_range" CHECK ("team_of_week"."tab_cents" is null or "team_of_week"."tab_cents" between 1 and 100000),
	CONSTRAINT "team_of_week_reason_length" CHECK (char_length("team_of_week"."reason") between 1 and 280),
	CONSTRAINT "team_of_week_tab_needs_sponsor" CHECK ("team_of_week"."tab_cents" is null or "team_of_week"."sponsor_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_sponsor_id_sponsor_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin" ADD CONSTRAINT "checkin_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_sponsor_id_sponsor_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_redemption" ADD CONSTRAINT "deal_redemption_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_redemption" ADD CONSTRAINT "deal_redemption_checkin_id_checkin_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."checkin"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_redemption" ADD CONSTRAINT "deal_redemption_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor" ADD CONSTRAINT "sponsor_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_member" ADD CONSTRAINT "sponsor_member_sponsor_id_sponsor_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_member" ADD CONSTRAINT "sponsor_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_of_week" ADD CONSTRAINT "team_of_week_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_of_week" ADD CONSTRAINT "team_of_week_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_of_week" ADD CONSTRAINT "team_of_week_sponsor_id_sponsor_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsor"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_of_week" ADD CONSTRAINT "team_of_week_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkin_sponsor_date_idx" ON "checkin" USING btree ("sponsor_id","on_date");--> statement-breakpoint
CREATE INDEX "checkin_user_idx" ON "checkin" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deal_sponsor_idx" ON "deal" USING btree ("sponsor_id");--> statement-breakpoint
CREATE INDEX "deal_redemption_checkin_idx" ON "deal_redemption" USING btree ("checkin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_one_home_bar" ON "sponsor" USING btree ("league_id") WHERE "sponsor"."is_home_bar" and "sponsor"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sponsor_member_user_idx" ON "sponsor_member" USING btree ("user_id");