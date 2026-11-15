ALTER TABLE "game" ADD COLUMN "ruled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "score_report" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "score_report" ADD CONSTRAINT "score_report_reason_by_admin" CHECK ("score_report"."reason" is null or ("score_report"."reporter_role" = 'admin' and char_length("score_report"."reason") between 1 and 300));