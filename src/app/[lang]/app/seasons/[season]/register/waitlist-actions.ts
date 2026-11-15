"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { seasonForRegistration } from "@/db/queries/registration";
import { joinWaitlist, leaveWaitlist } from "@/db/queries/waitlist";
import { registrationWindow } from "@/domain/registration/pricing";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { allowAction } from "@/lib/action-limit";
import { activeLeague } from "@/lib/league/active";
import { mayRegister } from "@/lib/private-events/invite";

/**
 * The team waitlist for a full season (roadmap item 13). Joining is for a
 * captain who cannot register a team because every spot is taken or held.
 */
async function context(slug: string) {
  const page = `/app/seasons/${slug}/register`;
  const subject = await requirePermissionToChange("team.register", {
    next: page,
  });
  const league = await activeLeague();
  const season = league
    ? await seasonForRegistration(db, league.id, slug)
    : null;
  if (!season || !(await mayRegister(season))) notFound();
  return { page, subject, season };
}

export async function joinWaitlistAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await context(slug);
  if (!(await allowAction("waitlist", `${season.id}:${subject.userId}`)))
    redirect(`${page}?waitlist=too_many`);
  const name = form.get("teamName");
  const now = new Date();
  const userId = subject.userId;
  const result = await txDb.transaction((tx) =>
    joinWaitlist(
      tx,
      {
        seasonId: season.id,
        maxTeams: season.maxTeams,
        userId,
        teamName: typeof name === "string" ? name : "",
        open: registrationWindow(season, now) === "open",
      },
      now,
    ),
  );
  redirect(`${page}?waitlist=${result.ok ? "joined" : result.error}`);
}

/** Leaves the line, or turns down a held spot so it passes to the next team. */
export async function leaveWaitlistAction(slug: string): Promise<void> {
  const { page, subject, season } = await context(slug);
  if (!(await allowAction("waitlist", `${season.id}:${subject.userId}`)))
    redirect(`${page}?waitlist=too_many`);
  const userId = subject.userId;
  await txDb.transaction((tx) =>
    leaveWaitlist(tx, { seasonId: season.id, userId }, new Date()),
  );
  redirect(`${page}?waitlist=left`);
}
