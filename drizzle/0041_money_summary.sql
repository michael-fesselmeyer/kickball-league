CREATE TABLE "money_summary" (
	"season_id" uuid PRIMARY KEY NOT NULL,
	"folded" "expense_category"[] DEFAULT '{}' NOT NULL,
	"summary" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	CONSTRAINT "money_summary_not_other" CHECK (not ('other' = any("money_summary"."folded")))
);
--> statement-breakpoint
ALTER TABLE "money_summary" ADD CONSTRAINT "money_summary_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_summary" ADD CONSTRAINT "money_summary_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;