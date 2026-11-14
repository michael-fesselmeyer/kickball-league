CREATE TYPE "public"."equipment_handoff_status" AS ENUM('pending', 'confirmed', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "equipment_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kit_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_assignment_kit_game_unique" UNIQUE("kit_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "equipment_handoff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kit_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"status" "equipment_handoff_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "equipment_handoff_decided" CHECK (("equipment_handoff"."status" = 'pending') = ("equipment_handoff"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "equipment_kit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contents" text[] NOT NULL,
	"home_location" text NOT NULL,
	"holder_id" uuid,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_kit_league_name_unique" UNIQUE("league_id","name"),
	CONSTRAINT "equipment_kit_name_length" CHECK (char_length("equipment_kit"."name") between 1 and 40),
	CONSTRAINT "equipment_kit_home_length" CHECK (char_length("equipment_kit"."home_location") between 1 and 120),
	CONSTRAINT "equipment_kit_contents_count" CHECK (cardinality("equipment_kit"."contents") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "equipment_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kit_id" uuid NOT NULL,
	"reporter_id" uuid,
	"missing" text[] NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "equipment_report_note_length" CHECK ("equipment_report"."note" is null or char_length("equipment_report"."note") between 1 and 500),
	CONSTRAINT "equipment_report_says_something" CHECK (cardinality("equipment_report"."missing") > 0 or "equipment_report"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "equipment_assignment" ADD CONSTRAINT "equipment_assignment_kit_id_equipment_kit_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."equipment_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignment" ADD CONSTRAINT "equipment_assignment_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignment" ADD CONSTRAINT "equipment_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_assignment" ADD CONSTRAINT "equipment_assignment_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_handoff" ADD CONSTRAINT "equipment_handoff_kit_id_equipment_kit_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."equipment_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_handoff" ADD CONSTRAINT "equipment_handoff_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_handoff" ADD CONSTRAINT "equipment_handoff_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_handoff" ADD CONSTRAINT "equipment_handoff_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_kit" ADD CONSTRAINT "equipment_kit_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_kit" ADD CONSTRAINT "equipment_kit_holder_id_user_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_report" ADD CONSTRAINT "equipment_report_kit_id_equipment_kit_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."equipment_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_report" ADD CONSTRAINT "equipment_report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_report" ADD CONSTRAINT "equipment_report_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_assignment_game_idx" ON "equipment_assignment" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "equipment_assignment_user_idx" ON "equipment_assignment" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_handoff_one_pending" ON "equipment_handoff" USING btree ("kit_id") WHERE "equipment_handoff"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "equipment_handoff_kit_created_idx" ON "equipment_handoff" USING btree ("kit_id","created_at");--> statement-breakpoint
CREATE INDEX "equipment_handoff_to_idx" ON "equipment_handoff" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "equipment_handoff_from_idx" ON "equipment_handoff" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "equipment_kit_holder_idx" ON "equipment_kit" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "equipment_report_kit_idx" ON "equipment_report" USING btree ("kit_id","created_at");--> statement-breakpoint
CREATE INDEX "equipment_report_reporter_idx" ON "equipment_report" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "equipment_report_resolved_by_idx" ON "equipment_report" USING btree ("resolved_by");