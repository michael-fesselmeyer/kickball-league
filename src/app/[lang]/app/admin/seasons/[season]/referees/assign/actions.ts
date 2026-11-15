"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { acceptProposals } from "@/db/queries/referee-pool";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { activeLeagueId } from "@/lib/league/active";
import { requirePermissionToChange } from "@/lib/auth/permission";

/** The screen to go back to, keeping the day it was on. */
const pageFor = (slug: string, day: string | null) =>
  `/app/admin/seasons/${slug}/referees/assign${day ? `?day=${day}` : ""}`;

/** A `YYYY-MM-DD` day from the form, or null for the whole season. */
const dayFrom = (form: FormData) => {
  const day = form.get("day");
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? day
    : null;
};

/** `gameId:userId`, as each proposal is sent, or null. */
function pairOf(value: FormDataEntryValue) {
  if (typeof value !== "string") return null;
  const [rawGame, rawUser] = value.split(":");
  const gameId = parseId<GameId>(rawGame);
  const userId = parseId<UserId>(rawUser);
  return gameId && userId ? { gameId, userId } : null;
}

async function accept(
  slug: string,
  form: FormData,
  pairs: { gameId: GameId; userId: UserId }[],
) {
  const day = dayFrom(form);
  const page = pageFor(slug, day);
  const subject = await requirePermissionToChange("referee.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const { assigned, skipped, why } = await txDb.transaction((tx) =>
    acceptProposals(tx, {
      seasonId: season.id,
      leagueId: season.leagueId,
      pairs,
      actorId: subject.userId,
    }),
  );
  const join = page.includes("?") ? "&" : "?";
  redirect(
    `${page}${join}assigned=${assigned}&skipped=${skipped}${why ? `&why=${why}` : ""}`,
  );
}

/** Accepts every proposal shown. */
export async function acceptAllAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const pairs = form.getAll("pair").flatMap((v) => pairOf(v) ?? []);
  await accept(slug, form, pairs);
}

/** Assigns one game: its proposed ref, or the one picked by hand. */
export async function assignOneAction(
  slug: string,
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const gameId = parseId<GameId>(rawGameId);
  const raw = form.get("userId");
  const userId = typeof raw === "string" ? parseId<UserId>(raw) : null;
  if (!gameId) notFound();
  await accept(slug, form, userId ? [{ gameId, userId }] : []);
}
