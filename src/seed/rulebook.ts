import { eq } from "drizzle-orm";
import {
  currentRules,
  publishRuleChange,
  rulesVersion,
  setRulebookVisibility,
} from "@/db/queries/rules";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema";
import { localDate } from "@/domain/books/ledger-csv";
import { planImport, splitRulebook } from "@/domain/rules/rulebook-import";
import { SAMPLE_RULEBOOK } from "@/domain/rules/sample-rulebook";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * The demo league's rulebook: an invented sample, imported the way an owner
 * would, and made public so the demo, the end-to-end tests and the
 * performance run have a rules page with text on it. A real league starts
 * owners only (ADR 0066).
 */
export async function addSeedRulebook(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.admin.email));
  if (!admin) return;
  const result = await publishRuleChange(db, {
    leagueId: data.league.id,
    actorId: admin.id,
    sections: planImport(
      await currentRules(db, data.league.id),
      splitRulebook(SAMPLE_RULEBOOK).sections,
    ),
    version: await rulesVersion(db, data.league.id),
    summary: "Added the sample rulebook",
    effectiveOn: "",
    notice: false,
    today: localDate(now, data.league.timezone),
    rulesPath: "/rules",
  });
  if (!result.ok) throw new Error(`Seeding the rulebook: ${result.error}`);
  await setRulebookVisibility(db, {
    leagueId: data.league.id,
    actorId: admin.id,
    visibility: "public",
  });
}
