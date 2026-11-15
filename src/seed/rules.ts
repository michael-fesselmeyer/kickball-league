import { eq } from "drizzle-orm";
import { publishRuleChange, setRulebookVisibility } from "@/db/queries/rules";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema";
import { localDate } from "@/domain/books/ledger-csv";
import { planImport, splitRulebook } from "@/domain/rules/rulebook-import";
import { SAMPLE_RULEBOOK } from "@/domain/rules/sample-rulebook";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * The demo league's rulebook (ADRs 0062 and 0066): the invented sample
 * rulebook, imported the way an owner would and made public, so the demo,
 * the end-to-end tests and the performance run have rules to read and
 * search. A real league starts owners only, writes its own rules in the app,
 * and its rulebook never goes in the repository.
 */
export async function addSeedRules(
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
    sections: planImport([], splitRulebook(SAMPLE_RULEBOOK).sections),
    version: "",
    summary: "The demo league's sample rules",
    effectiveOn: "",
    notice: false,
    today: localDate(now, data.league.timezone),
    rulesPath: "/rules",
  });
  if (!result.ok) throw new Error(`Seeding the rules failed: ${result.error}`);
  await setRulebookVisibility(db, {
    leagueId: data.league.id,
    actorId: admin.id,
    visibility: "public",
  });
}
