ALTER TYPE "public"."event_kind" ADD VALUE 'pickup';--> statement-breakpoint
ALTER TYPE "public"."event_kind" ADD VALUE 'practice';--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "field_id" uuid;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "open_play" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_field_idx" ON "event" USING btree ("field_id");