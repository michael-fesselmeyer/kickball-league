CREATE TABLE "win_back_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "win_back_email_once" UNIQUE("season_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "win_back_template" (
	"league_id" uuid PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "win_back_template_lengths" CHECK (char_length("win_back_template"."subject") between 1 and 120 and char_length("win_back_template"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "win_back_email" ADD CONSTRAINT "win_back_email_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win_back_email" ADD CONSTRAINT "win_back_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win_back_email" ADD CONSTRAINT "win_back_email_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win_back_template" ADD CONSTRAINT "win_back_template_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "win_back_template" ADD CONSTRAINT "win_back_template_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "win_back_email_user_idx" ON "win_back_email" USING btree ("user_id");