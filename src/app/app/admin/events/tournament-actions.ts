"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { eventBySlug } from "@/db/queries/events";
import {
  drawBracket,
  removeGuestTeam,
  resetBracket,
  saveTournament,
  updateBracketGame,
} from "@/db/queries/tournaments";
import type { GuestTeamId } from "@/domain/ids";
import { seededRandom } from "@/domain/random";
import { zonedInstant } from "@/domain/time/zoned";
import { parseSettings } from "@/domain/tournaments/tournament";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeague, activeLeagueId } from "@/lib/league/active";
import { refreshEventPages, refreshFriendPages } from "@/lib/public-cache";

const LIST = "/app/admin/events";

const SAVE_FIELDS = [
  "maxGuestTeams",
  "partnerFriendLeagueId",
  "charityName",
  "charityUrl",
  "charityGoal",
  "guestDataDays",
  "guestSignupsOpen",
] as const;

/** Back to the panel with a code its messages (tournament-messages.ts) know. */
const back = (slug: string, kind: "Saved" | "Error", code: string) =>
  `${LIST}/${slug}?tournament${kind}=${code}#tournament`;

async function load(slug: string) {
  const subject = await requirePermissionToChange("event.manage", {
    next: `${LIST}/${slug}`,
  });
  const league = await activeLeague();
  const e = await eventBySlug(db, await activeLeagueId(), slug, "all");
  if (!e || !league) notFound();
  return { subject, league, e };
}

/** Saves who can sign up, the charity link, the partner league and retention. */
export async function saveTournamentAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, league, e } = await load(slug);
  const parsed = parseSettings(formStrings(form, SAVE_FIELDS));
  if (!parsed.ok) redirect(back(slug, "Error", parsed.error));
  const result = await txDb.transaction((tx) =>
    saveTournament(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      settings: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  refreshFriendPages(league);
  redirect(back(slug, "Saved", "settings"));
}

export async function removeGuestTeamAction(
  slug: string,
  teamId: string,
): Promise<void> {
  const { subject, e } = await load(slug);
  const result = await txDb.transaction((tx) =>
    removeGuestTeam(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      teamId: teamId as GuestTeamId,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  redirect(back(slug, "Saved", "removed"));
}

export async function drawBracketAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { subject, e } = await load(slug);
  const random = form.get("order") === "random";
  const result = await txDb.transaction((tx) =>
    drawBracket(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      order: (teams) =>
        random ? seededRandom(Date.now() >>> 0).shuffle(teams) : teams,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  redirect(back(slug, "Saved", "drawn"));
}

export async function resetBracketAction(
  slug: string,
): Promise<void> {
  const { subject, e } = await load(slug);
  const result = await txDb.transaction((tx) =>
    resetBracket(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  redirect(back(slug, "Saved", "reset"));
}

/** A game's score, from the form's two whole numbers. */
export async function scoreGameAction(
  slug: string,
  code: string,
  form: FormData,
): Promise<void> {
  const { subject, e } = await load(slug);
  const f = formStrings(form, ["scoreA", "scoreB"] as const);
  const whole = (v: string) => (/^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN);
  const result = await txDb.transaction((tx) =>
    updateBracketGame(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      code,
      change: { kind: "score", scoreA: whole(f.scoreA), scoreB: whole(f.scoreB) },
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  redirect(back(slug, "Saved", "score"));
}

/** A game's field and start time, in the league's time zone. */
export async function scheduleGameAction(
  slug: string,
  code: string,
  form: FormData,
): Promise<void> {
  const { subject, e } = await load(slug);
  const f = formStrings(form, ["place", "date", "time"] as const);
  let startsAt: Date | null = null;
  if (f.date !== "" || f.time !== "") {
    try {
      startsAt = zonedInstant(f.date, f.time, e.timeZone);
    } catch {
      redirect(back(slug, "Error", "bad_time"));
    }
  }
  const result = await txDb.transaction((tx) =>
    updateBracketGame(tx, {
      leagueId: e.leagueId,
      eventId: e.id,
      code,
      change: { kind: "schedule", place: f.place, startsAt },
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(back(slug, "Error", result.error));
  refreshEventPages(slug);
  redirect(back(slug, "Saved", "schedule"));
}
