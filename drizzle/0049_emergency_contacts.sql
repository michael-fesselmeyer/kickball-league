CREATE TABLE "emergency_contact" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "emergency_contact" ADD CONSTRAINT "emergency_contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "emergency_contact_name";--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "emergency_contact_phone";