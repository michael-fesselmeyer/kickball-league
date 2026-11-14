CREATE TABLE "pickem_hidden" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickem_pick" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"team_season_id" uuid NOT NULL,
	"slot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickem_pick_once" UNIQUE("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "pickem_own_games" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pickem_hidden" ADD CONSTRAINT "pickem_hidden_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_pick" ADD CONSTRAINT "pickem_pick_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_pick" ADD CONSTRAINT "pickem_pick_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_pick" ADD CONSTRAINT "pickem_pick_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickem_pick" ADD CONSTRAINT "pickem_pick_slot_id_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickem_pick_user_idx" ON "pickem_pick" USING btree ("user_id");