ALTER TYPE "public"."books_file_kind" ADD VALUE 'layout';--> statement-breakpoint
CREATE TABLE "field_layout" (
	"field_id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid,
	"no_layout_needed" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_layout_one_answer" CHECK (not ("field_layout"."no_layout_needed" and "field_layout"."file_id" is not null)),
	CONSTRAINT "field_layout_note" CHECK ("field_layout"."note" is null or char_length("field_layout"."note") between 1 and 280)
);
--> statement-breakpoint
ALTER TABLE "field_layout" ADD CONSTRAINT "field_layout_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_layout" ADD CONSTRAINT "field_layout_file_id_books_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."books_file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_layout" ADD CONSTRAINT "field_layout_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;