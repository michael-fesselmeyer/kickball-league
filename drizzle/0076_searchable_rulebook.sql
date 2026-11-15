ALTER TABLE "league" ADD COLUMN "rulebook_visibility" text DEFAULT 'owners' NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_section" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "rule_section_search_idx" ON "rule_section" USING gin ("search");--> statement-breakpoint
ALTER TABLE "league" ADD CONSTRAINT "league_rulebook_visibility" CHECK ("league"."rulebook_visibility" in ('owners', 'members', 'public'));