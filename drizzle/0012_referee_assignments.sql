CREATE TYPE "public"."referee_assignment_status" AS ENUM('offered', 'accepted', 'declined', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "referee_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "referee_assignment_status" DEFAULT 'accepted' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"fee_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "referee_assignment" ADD CONSTRAINT "referee_assignment_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_assignment" ADD CONSTRAINT "referee_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referee_assignment" ADD CONSTRAINT "referee_assignment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referee_assignment_one_live" ON "referee_assignment" USING btree ("game_id") WHERE "referee_assignment"."status" in ('offered', 'accepted');--> statement-breakpoint
CREATE INDEX "referee_assignment_user_idx" ON "referee_assignment" USING btree ("user_id","status");