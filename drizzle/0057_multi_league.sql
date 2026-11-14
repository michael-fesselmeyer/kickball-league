CREATE TABLE "league_member" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "profile_global_role" DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_member_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
DROP INDEX "credit_entry_user_idx";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "league_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD COLUMN "league_id" uuid;--> statement-breakpoint
ALTER TABLE "league" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "league_id" uuid;--> statement-breakpoint
-- Hand-written backfill (ADR 0048), between the generated statements. When
-- this migration is generated again, add the columns above without NOT NULL
-- and keep this block before the generated foreign keys and the DROP COLUMN.
-- Until now a deployment had one league, so everything existing is its own.
INSERT INTO "league" ("name", "slug")
SELECT 'League', 'league'
WHERE NOT EXISTS (SELECT 1 FROM "league")
  AND (EXISTS (SELECT 1 FROM "audit_log") OR EXISTS (SELECT 1 FROM "purchase")
    OR EXISTS (SELECT 1 FROM "credit_entry")
    OR EXISTS (SELECT 1 FROM "profile" WHERE "global_role" <> 'player'));--> statement-breakpoint
UPDATE "league" SET "is_default" = true
WHERE "id" = (SELECT "id" FROM "league" ORDER BY "created_at", "id" LIMIT 1);--> statement-breakpoint
UPDATE "audit_log" SET "league_id" = (SELECT "id" FROM "league" WHERE "is_default");--> statement-breakpoint
UPDATE "credit_entry" SET "league_id" = (SELECT "id" FROM "league" WHERE "is_default");--> statement-breakpoint
UPDATE "purchase" SET "league_id" = (SELECT "id" FROM "league" WHERE "is_default");--> statement-breakpoint
INSERT INTO "league_member" ("league_id", "user_id", "role")
SELECT l."id", p."user_id", p."global_role"
FROM "profile" p CROSS JOIN "league" l
WHERE l."is_default" AND p."global_role" <> 'player';--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "league_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_entry" ALTER COLUMN "league_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ALTER COLUMN "league_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_member_user_idx" ON "league_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_league_id_league_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."league"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_league_idx" ON "audit_log" USING btree ("league_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "league_one_default" ON "league" USING btree ("is_default") WHERE "league"."is_default";--> statement-breakpoint
CREATE INDEX "purchase_league_idx" ON "purchase" USING btree ("league_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_entry_user_idx" ON "credit_entry" USING btree ("user_id","league_id","created_at");--> statement-breakpoint
ALTER TABLE "profile" DROP COLUMN "global_role";
