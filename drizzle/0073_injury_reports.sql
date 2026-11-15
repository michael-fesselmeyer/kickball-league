CREATE TYPE "public"."injury_body_area" AS ENUM('head', 'face', 'neck', 'shoulder', 'arm', 'hand', 'chest', 'back', 'hip', 'leg', 'knee', 'ankle_foot', 'other');--> statement-breakpoint
CREATE TYPE "public"."injury_care" AS ENUM('none', 'first_aid', 'ems');--> statement-breakpoint
ALTER TYPE "public"."incident_kind" ADD VALUE 'injury' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "injury_report" (
	"incident_id" uuid PRIMARY KEY NOT NULL,
	"hurt_user_id" uuid,
	"body_area" "injury_body_area" NOT NULL,
	"care" "injury_care" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "injury_witness" (
	"incident_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "injury_witness_incident_id_user_id_pk" PRIMARY KEY("incident_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "injury_report" ADD CONSTRAINT "injury_report_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injury_report" ADD CONSTRAINT "injury_report_hurt_user_id_user_id_fk" FOREIGN KEY ("hurt_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injury_witness" ADD CONSTRAINT "injury_witness_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injury_witness" ADD CONSTRAINT "injury_witness_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "injury_report_hurt_idx" ON "injury_report" USING btree ("hurt_user_id");--> statement-breakpoint
CREATE INDEX "injury_witness_user_idx" ON "injury_witness" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_injury_details_length" CHECK ("incident"."kind"::text <> 'injury' or char_length("incident"."details") <= 1000);