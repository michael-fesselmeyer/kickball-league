ALTER TABLE "league" ADD COLUMN "minimum_age" smallint DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE "season" ADD COLUMN "minimum_age" smallint;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "age_confirmed_min" smallint;--> statement-breakpoint
ALTER TABLE "registration" ADD COLUMN "age_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD COLUMN "age_confirmed_min" smallint;--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD COLUMN "age_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_minimum_age" CHECK ("league"."minimum_age" between 18 and 99);--> statement-breakpoint
ALTER TABLE "season" ADD CONSTRAINT "season_minimum_age" CHECK ("season"."minimum_age" is null or "season"."minimum_age" between 18 and 99);--> statement-breakpoint
ALTER TABLE "registration" ADD CONSTRAINT "registration_age_confirmed" CHECK (("registration"."age_confirmed_min" is null) = ("registration"."age_confirmed_at" is null) and ("registration"."age_confirmed_min" is null or "registration"."age_confirmed_min" between 18 and 99));--> statement-breakpoint
ALTER TABLE "waiver_signature" ADD CONSTRAINT "waiver_signature_age_confirmed" CHECK (("waiver_signature"."age_confirmed_min" is null) = ("waiver_signature"."age_confirmed_at" is null) and ("waiver_signature"."age_confirmed_min" is null or "waiver_signature"."age_confirmed_min" between 18 and 99));