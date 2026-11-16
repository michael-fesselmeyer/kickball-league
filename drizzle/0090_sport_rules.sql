ALTER TABLE "rule_set" ADD COLUMN "best_of" smallint;--> statement-breakpoint
ALTER TABLE "interest_option" ADD COLUMN "opened_league_id" uuid;--> statement-breakpoint
ALTER TABLE "interest_option" ADD CONSTRAINT "interest_option_opened_league_id_league_id_fk" FOREIGN KEY ("opened_league_id") REFERENCES "public"."league"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_best_of" CHECK ("rule_set"."best_of" is null or ("rule_set"."best_of" between 1 and 9 and "rule_set"."best_of" % 2 = 1));