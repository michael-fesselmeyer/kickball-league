import { and, eq, lt } from "drizzle-orm";
import { startSeasonChecklist } from "@/db/queries/checklist";
import type { Db } from "@/db/queries/schedule";
import { checklistTask, user } from "@/db/schema";
import { addDays } from "@/domain/season/rollover";
import { localDate } from "@/domain/books/ledger-csv";
import { PERSONAS } from "@/lib/demo/personas";
import type { SeedData } from "./generate";

/**
 * The current season's ops checklist (ADR 0053), started from the starter
 * template by the demo admin. The jobs that were due more than a week ago
 * are ticked off, and the admin owns what is left, so the dashboard's card
 * has something to show.
 */
export async function addSeedChecklist(
  db: Db,
  data: SeedData,
  now: Date,
): Promise<void> {
  const [admin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, PERSONAS.admin.email));
  if (!admin) return;
  await startSeasonChecklist(db, {
    seasonId: data.season.id,
    leagueId: data.league.id,
    startsOn: data.season.startsOn,
    actorId: admin.id,
  });
  const weekAgo = addDays(localDate(now, data.league.timezone), -7);
  await db
    .update(checklistTask)
    .set({ doneAt: now, doneBy: admin.id })
    .where(
      and(
        eq(checklistTask.seasonId, data.season.id),
        lt(checklistTask.dueOn, weekAgo),
      ),
    );
  await db
    .update(checklistTask)
    .set({ ownerId: admin.id })
    .where(eq(checklistTask.seasonId, data.season.id));
}
