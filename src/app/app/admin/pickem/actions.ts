"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { setOwnGamesAllowed } from "@/db/queries/pickem";
import { currentLeague } from "@/db/queries/seasons";
import { requirePermissionToChange } from "@/lib/auth/permission";

const PAGE = "/app/admin/pickem";

/** An admin decides whether players may pick their own team's games. */
export async function setOwnGamesAction(on: boolean): Promise<void> {
  const subject = await requirePermissionToChange("pickem.manage", {
    next: PAGE,
  });
  const league = await currentLeague(db);
  if (!league) notFound();
  await txDb.transaction((tx) =>
    setOwnGamesAllowed(tx, {
      leagueId: league.id,
      on,
      actorId: subject.userId,
    }),
  );
  redirect(`${PAGE}?notice=saved`);
}
