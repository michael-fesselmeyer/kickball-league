import { eq } from "drizzle-orm";
import { publishRuleChange } from "@/db/queries/rules";
import type { Db } from "@/db/queries/schedule";
import { user } from "@/db/schema";
import { localDate } from "@/domain/books/ledger-csv";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * Demo rules for the rules page (ADR 0056). Invented sample wording for the
 * demo league only; a real league writes its own rules in the app, and its
 * rulebook never goes in the repository.
 */
const SAMPLE_SECTIONS = [
  {
    title: "Lineups",
    body: "Sample rules for the demo league.\n\n- Each team kicks everyone who is at the game, in an order the captain sets before kickoff.\n- The order wraps from the last kicker to the first.\n- A player who arrives late joins the end of the order.",
  },
  {
    title: "Fielding",
    body: "Sample rules for the demo league.\n\nTen players field at a time. A team with fewer than eight players may borrow from the other team so the game can go ahead.",
  },
  {
    title: "Playoffs",
    body: "Sample rules for the demo league.\n\nThe top teams in the standings play a single-elimination bracket. Ties in the standings are broken by head-to-head results, then run difference.",
  },
];

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
    sections: SAMPLE_SECTIONS.map((s) => ({ id: null, ...s, remove: false })),
    version: "",
    summary: "The demo league's sample rules",
    effectiveOn: "",
    notice: false,
    today: localDate(now, data.league.timezone),
  });
  if (!result.ok) throw new Error(`Seeding the rules failed: ${result.error}`);
}
