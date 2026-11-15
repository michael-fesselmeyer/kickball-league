import { eq } from "drizzle-orm";
import { openInterestForm, saveAnswer } from "@/db/queries/interest";
import type { Db } from "@/db/queries/schedule";
import { interestOption, user } from "@/db/schema";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * A demo interest form with invented answers, so the public form and the
 * admin totals show something. The addresses are `example.test` ones.
 */
export async function addSeedInterest(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.admin.email));
  if (!admin) return;
  const opened = await openInterestForm(db, {
    leagueId: data.league.id,
    actorId: admin.id,
    form: {
      title: "Where should we grow?",
      intro:
        "We're thinking about a second night. Tell us what you would play.",
      teamsNeeded: 8,
      playersPerTeam: 12,
    },
    options: [
      { park: "Sample Park", night: "thursday", format: "social" },
      { park: null, night: "sunday", format: "competitive" },
    ],
  });
  if (!opened.ok) throw new Error(`Seeding interest failed: ${opened.error}`);
  const options = await db
    .select({ id: interestOption.id, night: interestOption.night })
    .from(interestOption)
    .where(eq(interestOption.formId, opened.value));
  const thursday = options.find((o) => o.night === "thursday");
  const sunday = options.find((o) => o.night === "sunday");
  if (!thursday || !sunday) return;
  for (let i = 0; i < 6; i++) {
    const saved = await saveAnswer(db, {
      formId: opened.value,
      now,
      answer: {
        email: `interest-${i}@example.test`,
        friends: i % 3,
        choices: [
          { optionId: thursday.id, response: i < 4 ? "yes" : "unsure" },
          ...(i % 2 === 0
            ? [{ optionId: sunday.id, response: "unsure" as const }]
            : []),
        ],
      },
    });
    if (!saved.ok) throw new Error(`Seeding interest failed: ${saved.error}`);
  }
}
