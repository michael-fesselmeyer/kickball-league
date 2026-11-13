CREATE TYPE "public"."event_ticket_status" AS ENUM('offered', 'held', 'paid', 'refunded', 'released', 'cancelled');--> statement-breakpoint
CREATE TABLE "event_ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purchase_id" uuid,
	"status" "event_ticket_status" NOT NULL,
	"price_cents" integer,
	"code" text NOT NULL,
	"held_until" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_code_unique" UNIQUE("event_id","code"),
	CONSTRAINT "event_ticket_purchase_unique" UNIQUE("purchase_id"),
	CONSTRAINT "event_ticket_code_format" CHECK ("event_ticket"."code" ~ '^[A-HJ-NP-Z2-9]{6}$'),
	CONSTRAINT "event_ticket_held_until" CHECK (("event_ticket"."status" in ('offered', 'held')) = ("event_ticket"."held_until" is not null)),
	CONSTRAINT "event_ticket_purchase" CHECK ("event_ticket"."status" in ('offered', 'released', 'cancelled') or ("event_ticket"."purchase_id" is not null and "event_ticket"."price_cents" is not null)),
	CONSTRAINT "event_ticket_price_cents" CHECK ("event_ticket"."price_cents" is null or "event_ticket"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "ticket_price_cents" integer;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "member_price_cents" integer;--> statement-breakpoint
ALTER TABLE "event_ticket" ADD CONSTRAINT "event_ticket_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket" ADD CONSTRAINT "event_ticket_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket" ADD CONSTRAINT "event_ticket_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_ticket_event_status_idx" ON "event_ticket" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "event_ticket_user_idx" ON "event_ticket" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_price_range" CHECK ("event"."ticket_price_cents" is null or "event"."ticket_price_cents" between 50 and 50000);--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_member_price" CHECK ("event"."member_price_cents" is null or ("event"."ticket_price_cents" is not null and "event"."member_price_cents" <= "event"."ticket_price_cents" and ("event"."member_price_cents" = 0 or "event"."member_price_cents" >= 50)));--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_ticket_sold_in_app" CHECK ("event"."ticket_price_cents" is null or ("event"."in_app_rsvp" and "event"."kind" <> 'theme_week'));