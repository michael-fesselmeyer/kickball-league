CREATE TABLE "giveaway" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"prize" text NOT NULL,
	"donated_by" text,
	"winner_count" smallint DEFAULT 1 NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"official_rules" text NOT NULL,
	"checkin_secret" text NOT NULL,
	"drawn_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giveaway_one_per_event" UNIQUE("event_id"),
	CONSTRAINT "giveaway_prize_length" CHECK (char_length("giveaway"."prize") between 1 and 200),
	CONSTRAINT "giveaway_donated_by_length" CHECK ("giveaway"."donated_by" is null or char_length("giveaway"."donated_by") between 1 and 80),
	CONSTRAINT "giveaway_winner_count" CHECK ("giveaway"."winner_count" between 1 and 20),
	CONSTRAINT "giveaway_window_order" CHECK ("giveaway"."closes_at" > "giveaway"."opens_at"),
	CONSTRAINT "giveaway_rules_length" CHECK (char_length("giveaway"."official_rules") between 20 and 5000),
	CONSTRAINT "giveaway_checkin_secret_length" CHECK (char_length("giveaway"."checkin_secret") >= 32)
);
--> statement-breakpoint
CREATE TABLE "giveaway_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giveaway_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giveaway_entry_once" UNIQUE("giveaway_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "giveaway_winner" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"giveaway_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL,
	"drawn_by" uuid,
	"replaced_at" timestamp with time zone,
	"replaced_reason" text,
	CONSTRAINT "giveaway_winner_once" UNIQUE("giveaway_id","entry_id"),
	CONSTRAINT "giveaway_winner_round" CHECK ("giveaway_winner"."round" >= 1),
	CONSTRAINT "giveaway_winner_replaced_reason" CHECK (("giveaway_winner"."replaced_at" is null) = ("giveaway_winner"."replaced_reason" is null)),
	CONSTRAINT "giveaway_winner_reason_length" CHECK ("giveaway_winner"."replaced_reason" is null or char_length("giveaway_winner"."replaced_reason") between 5 and 300)
);
--> statement-breakpoint
CREATE TABLE "signup_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"prize" text NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"winner_team_season_id" uuid,
	"winner_completed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_challenge_one_per_season" UNIQUE("season_id"),
	CONSTRAINT "signup_challenge_prize_length" CHECK (char_length("signup_challenge"."prize") between 1 and 200),
	CONSTRAINT "signup_challenge_winner_confirmed" CHECK ("signup_challenge"."winner_team_season_id" is null or "signup_challenge"."confirmed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "giveaway" ADD CONSTRAINT "giveaway_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway" ADD CONSTRAINT "giveaway_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entry" ADD CONSTRAINT "giveaway_entry_giveaway_id_giveaway_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaway"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entry" ADD CONSTRAINT "giveaway_entry_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_winner" ADD CONSTRAINT "giveaway_winner_giveaway_id_giveaway_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaway"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_winner" ADD CONSTRAINT "giveaway_winner_entry_id_giveaway_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."giveaway_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_winner" ADD CONSTRAINT "giveaway_winner_drawn_by_user_id_fk" FOREIGN KEY ("drawn_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_challenge" ADD CONSTRAINT "signup_challenge_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_challenge" ADD CONSTRAINT "signup_challenge_winner_team_season_id_team_season_id_fk" FOREIGN KEY ("winner_team_season_id") REFERENCES "public"."team_season"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_challenge" ADD CONSTRAINT "signup_challenge_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_challenge" ADD CONSTRAINT "signup_challenge_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "giveaway_entry_user_idx" ON "giveaway_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "giveaway_winner_entry_idx" ON "giveaway_winner" USING btree ("entry_id");