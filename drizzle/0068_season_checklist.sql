CREATE TABLE "checklist_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"template_task_id" uuid,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_on" date NOT NULL,
	"owner_id" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_task_from_template_once" UNIQUE("season_id","template_task_id"),
	CONSTRAINT "checklist_task_title_length" CHECK (char_length("checklist_task"."title") between 1 and 120),
	CONSTRAINT "checklist_task_notes_length" CHECK (char_length("checklist_task"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "checklist_template_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"offset_days" smallint NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_template_task_title_length" CHECK (char_length("checklist_template_task"."title") between 1 and 120),
	CONSTRAINT "checklist_template_task_notes_length" CHECK (char_length("checklist_template_task"."notes") <= 1000),
	CONSTRAINT "checklist_template_task_offset" CHECK ("checklist_template_task"."offset_days" between -365 and 365)
);
--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_template_task_id_checklist_template_task_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."checklist_template_task"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_task" ADD CONSTRAINT "checklist_template_task_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_task" ADD CONSTRAINT "checklist_template_task_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_task_season_due_idx" ON "checklist_task" USING btree ("season_id","due_on");--> statement-breakpoint
CREATE INDEX "checklist_task_open_due_idx" ON "checklist_task" USING btree ("due_on") WHERE "checklist_task"."done_at" is null;--> statement-breakpoint
CREATE INDEX "checklist_template_task_league_idx" ON "checklist_template_task" USING btree ("league_id");