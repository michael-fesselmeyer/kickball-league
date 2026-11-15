"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { setOwnGamesAllowed } from "@/db/queries/pickem";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

const PAGE = "/app/admin/pickem";

/** An admin decides whether players may pick their own team's games. */
export async function setOwnGamesAction(on: boolean): Promise<void> {
  const subject = await requirePermissionToChange("pickem.manage", {
    next: PAGE,
  });
  const league = await activeLeague();
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
