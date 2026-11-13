CREATE TYPE "public"."books_file_kind" AS ENUM('receipt', 'permit', 'insurance');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('fields_permits', 'equipment', 'shirts', 'refs', 'events', 'sponsor_costs', 'other');--> statement-breakpoint
CREATE TABLE "books_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"kind" "books_file_kind" NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_file_type" CHECK ("books_file"."content_type" in ('image/webp', 'application/pdf')),
	CONSTRAINT "books_file_size" CHECK ("books_file"."byte_size" = octet_length("books_file"."bytes") and "books_file"."byte_size" between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"category" "expense_category" NOT NULL,
	"note" text,
	"receipt_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_amount" CHECK ("expense"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "insurance_certificate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text,
	"starts_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"document_file_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_certificate_dates" CHECK ("insurance_certificate"."expires_on" > "insurance_certificate"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "permit_window" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "permit_window" ADD COLUMN "document_file_id" uuid;--> statement-breakpoint
ALTER TABLE "permit_window" ADD COLUMN "application_opens_on" date;--> statement-breakpoint
ALTER TABLE "permit_window" ADD COLUMN "application_closes_on" date;--> statement-breakpoint
ALTER TABLE "permit_window" ADD COLUMN "renews_on" date;--> statement-breakpoint
ALTER TABLE "books_file" ADD CONSTRAINT "books_file_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books_file" ADD CONSTRAINT "books_file_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_receipt_file_id_books_file_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."books_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_certificate" ADD CONSTRAINT "insurance_certificate_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_certificate" ADD CONSTRAINT "insurance_certificate_document_file_id_books_file_id_fk" FOREIGN KEY ("document_file_id") REFERENCES "public"."books_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_certificate" ADD CONSTRAINT "insurance_certificate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_file_league" ON "books_file" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "expense_season" ON "expense" USING btree ("season_id","spent_on");--> statement-breakpoint
CREATE INDEX "expense_receipt" ON "expense" USING btree ("receipt_file_id");--> statement-breakpoint
CREATE INDEX "insurance_certificate_league" ON "insurance_certificate" USING btree ("league_id","expires_on");--> statement-breakpoint
CREATE INDEX "insurance_certificate_document" ON "insurance_certificate" USING btree ("document_file_id");--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_document_file_id_books_file_id_fk" FOREIGN KEY ("document_file_id") REFERENCES "public"."books_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "permit_window_document_idx" ON "permit_window" USING btree ("document_file_id");--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_cost" CHECK ("permit_window"."cost_cents" is null or "permit_window"."cost_cents" >= 0);--> statement-breakpoint
ALTER TABLE "permit_window" ADD CONSTRAINT "permit_window_application_order" CHECK ("permit_window"."application_closes_on" is null or "permit_window"."application_opens_on" is null or "permit_window"."application_closes_on" >= "permit_window"."application_opens_on");