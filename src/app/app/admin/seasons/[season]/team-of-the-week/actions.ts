"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { removeTeamOfWeek, setTeamOfWeek } from "@/db/queries/sponsors";
import { parseId, type SponsorId, type TeamSeasonId } from "@/domain/ids";
import { parseTeamOfWeekForm } from "@/domain/sponsors/team-of-week";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { refreshSponsorPages } from "@/lib/public-cache";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/team-of-the-week`;

/** Names the team of the week for a game day, or changes who it is. */
export async function setTeamOfWeekAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season) notFound();
  const fields = formStrings(form, [
    "day",
    "team",
    "sponsor",
    "tab",
    "reason",
  ] as const);
  const parsed = parseTeamOfWeekForm(fields);
  const back = `${page}?day=${encodeURIComponent(fields.day)}`;
  if (!parsed.ok) redirect(`${back}&error=${parsed.error}`);
  const teamSeasonId = parseId<TeamSeasonId>(parsed.value.teamSeasonId);
  const sponsorId =
    parsed.value.sponsorId === null
      ? null
      : parseId<SponsorId>(parsed.value.sponsorId);
  if (!teamSeasonId || (parsed.value.sponsorId !== null && !sponsorId))
    redirect(`${back}&error=no_team`);
  const result = await txDb.transaction((tx) =>
    setTeamOfWeek(tx, {
      seasonId: season.id,
      weekOf: parsed.value.weekOf,
      teamSeasonId,
      sponsorId,
      tabCents: parsed.value.tabCents,
      reason: parsed.value.reason,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${back}&error=no_team`);
  refreshSponsorPages();
  redirect(`${back}&notice=saved`);
}

export async function removeTeamOfWeekAction(
  slug: string,
  day: string,
): Promise<void> {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("season.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, slug);
  if (!season || !/^\d{4}-\d{2}-\d{2}$/.test(day)) notFound();
  await txDb.transaction((tx) =>
    removeTeamOfWeek(tx, {
      seasonId: season.id,
      weekOf: day,
      actorId: subject.userId,
    }),
  );
  refreshSponsorPages();
  redirect(`${page}?notice=removed`);
}
