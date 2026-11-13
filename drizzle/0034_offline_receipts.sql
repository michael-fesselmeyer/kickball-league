CREATE TYPE "public"."offline_entry_kind" AS ENUM('score', 'half', 'end');--> statement-breakpoint
CREATE TABLE "offline_receipt" (
	"key" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"kind" "offline_entry_kind" NOT NULL,
	"result" jsonb NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offline_receipt" ADD CONSTRAINT "offline_receipt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_receipt" ADD CONSTRAINT "offline_receipt_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_receipt_game_idx" ON "offline_receipt" USING btree ("game_id");