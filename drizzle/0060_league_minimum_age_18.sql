ALTER TABLE "league" ALTER COLUMN "minimum_age" SET DEFAULT 18;--> statement-breakpoint
-- A league still on the old default moves to the new one (ADR 0050). A
-- season's own minimum age stays as its admin set it.
UPDATE "league" SET "minimum_age" = 18 WHERE "minimum_age" = 21;
