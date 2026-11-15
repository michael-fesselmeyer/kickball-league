ALTER TABLE "announcement" ADD COLUMN "send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcement" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "announcement_due_idx" ON "announcement" USING btree ("send_at") WHERE "announcement"."sent_at" is null and "announcement"."cancelled_at" is null;--> statement-breakpoint
-- Every announcement before scheduling was sent as it was written (ADR 0058).
UPDATE "announcement" SET "sent_at" = "created_at" WHERE "sent_at" IS NULL;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_sent_or_waiting" CHECK (("announcement"."sent_at" is not null and "announcement"."cancelled_at" is null) or ("announcement"."sent_at" is null and "announcement"."send_at" is not null));