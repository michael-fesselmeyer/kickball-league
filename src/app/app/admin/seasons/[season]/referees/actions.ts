"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addToRefereePool,
  removeFromRefereePool,
} from "@/db/queries/referee-pool";
import { assignReferee, unassignReferee } from "@/db/queries/referees";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { requireInLeague } from "@/lib/league/guard";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/referees`;

async function context(slug: string, rawGameId: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("referee.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  const gameId = parseId<GameId>(rawGameId);
  if (!season || !gameId) notFound();
  await requireInLeague(season, { game: gameId });
  return { page, subject, season, gameId };
}

export async function assignRefereeAction(
  slug: string,
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season, gameId } = await context(slug, rawGameId);
  const email = form.get("email");
  const result = await txDb.transaction((tx) =>
    assignReferee(tx, {
      seasonId: season.id,
      gameId,
      email: typeof email === "string" ? email : "",
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#game-${gameId}`);
  redirect(`${page}?notice=assigned#game-${gameId}`);
}

export async function unassignRefereeAction(
  slug: string,
  rawGameId: string,
): Promise<void> {
  const { page, subject, season, gameId } = await context(slug, rawGameId);
  await txDb.transaction((tx) =>
    unassignReferee(tx, {
      seasonId: season.id,
      gameId,
      actorId: subject.userId,
    }),
  );
  redirect(`${page}?notice=removed#game-${gameId}`);
}

async function poolContext(slug: string) {
  const page = pageFor(slug);
  const subject = await requirePermissionToChange("referee.manage", {
    next: page,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  return { page, subject, season };
}

export async function addToPoolAction(
  slug: string,
  form: FormData,
): Promise<void> {
  const { page, subject, season } = await poolContext(slug);
  const email = form.get("email");
  const result = await txDb.transaction((tx) =>
    addToRefereePool(tx, {
      leagueId: season.leagueId,
      email: typeof email === "string" ? email : "",
      actorId: subject.userId,
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}#pool`);
  redirect(`${page}?notice=pool_added#pool`);
}

export async function removeFromPoolAction(
  slug: string,
  rawUserId: string,
): Promise<void> {
  const { page, subject, season } = await poolContext(slug);
  const userId = parseId<UserId>(rawUserId);
  if (!userId) notFound();
  await txDb.transaction((tx) =>
    removeFromRefereePool(tx, {
      leagueId: season.leagueId,
      userId,
      actorId: subject.userId,
    }),
  );
  redirect(`${page}?notice=pool_removed#pool`);
}
