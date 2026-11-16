CREATE TABLE "shirt_maker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"makes" text NOT NULL,
	"minimum_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "shirt_maker_name_unique" UNIQUE("league_id","name"),
	CONSTRAINT "shirt_maker_name_length" CHECK (char_length("shirt_maker"."name") between 1 and 80),
	CONSTRAINT "shirt_maker_makes_length" CHECK (char_length("shirt_maker"."makes") between 1 and 200),
	CONSTRAINT "shirt_maker_minimum" CHECK ("shirt_maker"."minimum_order" is null or "shirt_maker"."minimum_order" between 1 and 1000),
	CONSTRAINT "shirt_maker_url_https" CHECK ("shirt_maker"."url" ~ '^https://' and char_length("shirt_maker"."url") <= 300)
);
--> statement-breakpoint
CREATE TABLE "shirt_spare" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"size" "profile_shirt_size" NOT NULL,
	"delta" integer NOT NULL,
	"registration_id" uuid,
	"note" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shirt_spare_delta" CHECK ("shirt_spare"."delta" between -1 and 500 and "shirt_spare"."delta" <> 0),
	CONSTRAINT "shirt_spare_handout" CHECK ("shirt_spare"."delta" < 0 or "shirt_spare"."registration_id" is null),
	CONSTRAINT "shirt_spare_note" CHECK ("shirt_spare"."note" is null or char_length("shirt_spare"."note") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "team_season" ADD COLUMN "own_shirts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_season" ADD COLUMN "shirt_design" text;--> statement-breakpoint
ALTER TABLE "shirt_maker" ADD CONSTRAINT "shirt_maker_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shirt_maker" ADD CONSTRAINT "shirt_maker_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shirt_spare" ADD CONSTRAINT "shirt_spare_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shirt_spare" ADD CONSTRAINT "shirt_spare_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shirt_spare" ADD CONSTRAINT "shirt_spare_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shirt_spare_league_size_idx" ON "shirt_spare" USING btree ("league_id","size");--> statement-breakpoint
ALTER TABLE "team_season" ADD CONSTRAINT "team_season_shirt_design_length" CHECK ("team_season"."shirt_design" is null or char_length("team_season"."shirt_design") between 1 and 120);