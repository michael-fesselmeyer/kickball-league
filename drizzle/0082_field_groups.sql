CREATE TABLE "field_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekdays" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"starts_at" time(0),
	"ends_at" time(0),
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "field_group_name" CHECK (length(btrim("field_group"."name")) between 1 and 80),
	CONSTRAINT "field_group_weekdays" CHECK ("field_group"."weekdays" <@ array[0,1,2,3,4,5,6]),
	CONSTRAINT "field_group_hours" CHECK ((cardinality("field_group"."weekdays") = 0 and "field_group"."starts_at" is null and "field_group"."ends_at" is null)
        or (cardinality("field_group"."weekdays") > 0 and "field_group"."starts_at" is not null and "field_group"."ends_at" is not null and "field_group"."starts_at" <> "field_group"."ends_at")),
	CONSTRAINT "field_group_contact" CHECK ("field_group"."contact" is null or length("field_group"."contact") <= 200)
);
--> statement-breakpoint
CREATE TABLE "field_overlap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "field_overlap_group_date_unique" UNIQUE("group_id","on_date"),
	CONSTRAINT "field_overlap_note" CHECK ("field_overlap"."note" is null or length("field_overlap"."note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "field_group" ADD CONSTRAINT "field_group_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_group" ADD CONSTRAINT "field_group_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_overlap" ADD CONSTRAINT "field_overlap_group_id_field_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."field_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_overlap" ADD CONSTRAINT "field_overlap_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_group_field_idx" ON "field_group" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "field_overlap_date_idx" ON "field_overlap" USING btree ("on_date");