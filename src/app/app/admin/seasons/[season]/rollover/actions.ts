"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import { rollOver } from "@/db/queries/rollover";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";

/** Creates the new draft season from the preview's choices. */
export async function rollOverAction(slug: string, form: FormData) {
  const page = `/app/admin/seasons/${slug}/rollover`;
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const league = await activeLeague();
  if (!league) notFound();
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const teamIds = new Set(
    form.getAll("team").flatMap((v) => (typeof v === "string" ? [v] : [])),
  );
  const result = await txDb.transaction((tx) =>
    rollOver(
      tx,
      {
        leagueId: league.id,
        slug,
        choice: { name: text("name"), startsOn: text("startsOn"), teamIds },
      },
      subject.userId,
      new Date(),
    ),
  );
  if (!result.ok) {
    const back = new URLSearchParams({
      error: result.error,
      name: text("name"),
      startsOn: text("startsOn"),
      chosen: "1",
    });
    for (const id of teamIds) back.append("team", id);
    redirect(`${page}?${back.toString()}`);
  }
  redirect(
    `/app/admin/seasons/${result.value.slug}?rolled=${result.value.teams}`,
  );
}
