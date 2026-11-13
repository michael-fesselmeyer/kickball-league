CREATE TYPE "public"."merch_kind" AS ENUM('league', 'team_jersey');--> statement-breakpoint
CREATE TYPE "public"."merch_order_status" AS ENUM('held', 'paid', 'fulfilled', 'refunded', 'released');--> statement-breakpoint
CREATE TYPE "public"."merch_size" AS ENUM('xs', 's', 'm', 'l', 'xl', 'xxl', 'one_size');--> statement-breakpoint
CREATE TABLE "merch_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"alt" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merch_image_position" UNIQUE("item_id","position"),
	CONSTRAINT "merch_image_type" CHECK ("merch_image"."content_type" = 'image/webp'),
	CONSTRAINT "merch_image_size" CHECK ("merch_image"."byte_size" = octet_length("merch_image"."bytes") and "merch_image"."byte_size" between 1 and 2097152),
	CONSTRAINT "merch_image_alt" CHECK (length(trim("merch_image"."alt")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "merch_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"kind" "merch_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"member_price_cents" integer,
	"made_to_order" boolean DEFAULT false NOT NULL,
	"order_deadline" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merch_item_name" CHECK (length(trim("merch_item"."name")) between 1 and 80),
	CONSTRAINT "merch_item_price" CHECK ("merch_item"."price_cents" between 50 and 50000 and ("merch_item"."member_price_cents" is null or "merch_item"."member_price_cents" between 0 and "merch_item"."price_cents"))
);
--> statement-breakpoint
CREATE TABLE "merch_item_size" (
	"item_id" uuid NOT NULL,
	"size" "merch_size" NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "merch_item_size_item_id_size_pk" PRIMARY KEY("item_id","size"),
	CONSTRAINT "merch_item_size_stock" CHECK ("merch_item_size"."stock" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "merch_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"status" "merch_order_status" NOT NULL,
	"size" "merch_size" NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"team_season_id" uuid,
	"team_name" text,
	"color_hex" text,
	"held_until" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"fulfilled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merch_order_purchase_unique" UNIQUE("purchase_id"),
	CONSTRAINT "merch_order_quantity" CHECK ("merch_order"."quantity" between 1 and 5),
	CONSTRAINT "merch_order_unit_price" CHECK ("merch_order"."unit_price_cents" >= 0),
	CONSTRAINT "merch_order_held_until" CHECK (("merch_order"."status" = 'held') = ("merch_order"."held_until" is not null)),
	CONSTRAINT "merch_order_fulfilled" CHECK ("merch_order"."status" <> 'fulfilled' or "merch_order"."fulfilled_at" is not null),
	CONSTRAINT "merch_order_color_hex" CHECK ("merch_order"."color_hex" is null or "merch_order"."color_hex" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "merch_image" ADD CONSTRAINT "merch_image_item_id_merch_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merch_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_item" ADD CONSTRAINT "merch_item_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_item" ADD CONSTRAINT "merch_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_item_size" ADD CONSTRAINT "merch_item_size_item_id_merch_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merch_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_order" ADD CONSTRAINT "merch_order_item_id_merch_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."merch_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_order" ADD CONSTRAINT "merch_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_order" ADD CONSTRAINT "merch_order_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_order" ADD CONSTRAINT "merch_order_team_season_id_team_season_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merch_order" ADD CONSTRAINT "merch_order_fulfilled_by_user_id_fk" FOREIGN KEY ("fulfilled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merch_item_league_idx" ON "merch_item" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "merch_order_item_status_idx" ON "merch_order" USING btree ("item_id","status");--> statement-breakpoint
CREATE INDEX "merch_order_user_idx" ON "merch_order" USING btree ("user_id");