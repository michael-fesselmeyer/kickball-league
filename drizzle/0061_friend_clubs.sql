CREATE TABLE "friend_click" (
	"friend_league_id" uuid NOT NULL,
	"day" date NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "friend_click_friend_league_id_day_pk" PRIMARY KEY("friend_league_id","day"),
	CONSTRAINT "friend_click_clicks" CHECK ("friend_click"."clicks" >= 0)
);
--> statement-breakpoint
ALTER TABLE "friend_league" ADD COLUMN "run_by_player" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_league" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_click" ADD CONSTRAINT "friend_click_friend_league_id_friend_league_id_fk" FOREIGN KEY ("friend_league_id") REFERENCES "public"."friend_league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_league" ADD CONSTRAINT "friend_league_featured_player_run" CHECK (not "friend_league"."featured" or "friend_league"."run_by_player");