CREATE TABLE "account_merge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kept_user_id" uuid NOT NULL,
	"merged_user_id" uuid NOT NULL,
	"merged_email" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_merge_two_accounts" CHECK ("account_merge"."kept_user_id" <> "account_merge"."merged_user_id"),
	CONSTRAINT "account_merge_email_lower" CHECK ("account_merge"."merged_email" = lower("account_merge"."merged_email"))
);
--> statement-breakpoint
ALTER TABLE "account_merge" ADD CONSTRAINT "account_merge_kept_user_id_user_id_fk" FOREIGN KEY ("kept_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_merge" ADD CONSTRAINT "account_merge_merged_user_id_user_id_fk" FOREIGN KEY ("merged_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_merge" ADD CONSTRAINT "account_merge_merged_by_user_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_merge_merged_once" ON "account_merge" USING btree ("merged_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_merge_email_once" ON "account_merge" USING btree ("merged_email");--> statement-breakpoint
CREATE INDEX "account_merge_kept_idx" ON "account_merge" USING btree ("kept_user_id");