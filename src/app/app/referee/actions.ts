"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  leagueOfSeason,
  myRefereeGames,
  seasonGameTimes,
  setAvailability,
} from "@/db/queries/referee-pool";
import {
  dropRefereeGame,
  leagueOfGame,
  takeRefereeGame,
} from "@/db/queries/referee-cover";
import { type GameId, parseId, type SeasonId, type UserId } from "@/domain/ids";
import { parseDropReason } from "@/domain/referees/cover";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/referee";

/**
 * Saves which of a season's game times this ref can work. Only times the
 * season really has, and that haven't started, are taken from the form.
 * A time they already referee a game at stays as it is: taking it back
 * would leave that game's ref saying they can't be there, so they ask an
 * admin to take them off it instead.
 */
export async function saveAvailabilityAction(
  rawSeasonId: string,
  form: FormData,
): Promise<void> {
  const seasonId = parseId<SeasonId>(rawSeasonId);
  if (!seasonId) notFound();
  const leagueId = await leagueOfSeason(db, seasonId);
  if (!leagueId) notFound();
  // A season of another league is refused like a missing one.
  const subject = await requirePermissionToChange("referee.availability", {
    next: PAGE,
    leagueId,
  });
  const userId = parseId<UserId>(subject.userId);
  if (!userId) notFound();
  const now = Date.now();
  const [gameTimes, games] = await Promise.all([
    seasonGameTimes(db, seasonId),
    myRefereeGames(db, { seasonId, userId }),
  ]);
  const reffing = new Set(games.map((g) => g.startsAt.getTime()));
  const real = new Set(
    gameTimes.map((d) => d.getTime()).filter((t) => t > now && !reffing.has(t)),
  );
  const times = (name: string) =>
    form
      .getAll(name)
      .flatMap((v) => (typeof v === "string" ? [Date.parse(v)] : []))
      .filter((t) => real.has(t))
      .map((t) => new Date(t));
  await txDb.transaction((tx) =>
    setAvailability(tx, {
      seasonId,
      userId,
      shown: times("shown"),
      ticked: times("free"),
    }),
  );
  redirect(`${PAGE}?saved=1#season-${seasonId}`);
}

/**
 * A ref drops a game they can't make, with a reason, until it starts. If
 * it starts within a day, the league's refs who are free then are asked
 * at once.
 */
export async function dropGameAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const gameId = parseId<GameId>(rawGameId);
  if (!gameId) notFound();
  const leagueId = await leagueOfGame(db, gameId);
  if (!leagueId) notFound();
  // Another league's game is refused like a missing one.
  const subject = await requirePermissionToChange("referee.availability", {
    next: PAGE,
    leagueId,
  });
  const userId = parseId<UserId>(subject.userId);
  if (!userId) notFound();
  const reason = parseDropReason(form.get("reason"));
  if (reason === null) redirect(`${PAGE}?error=reason#game-${gameId}`);
  const result = await txDb.transaction((tx) =>
    dropRefereeGame(tx, { gameId, userId, reason, now: new Date() }),
  );
  if (!result.ok) redirect(`${PAGE}?error=${result.error}#game-${gameId}`);
  if (result.value.asked > 0) sendQueuedSoon();
  redirect(`${PAGE}?dropped=${result.value.asked}`);
}

/** "Take it": the first ref to tap gets the game. */
export async function takeGameAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const gameId = parseId<GameId>(rawGameId);
  if (!gameId) notFound();
  const page = `${PAGE}/take/${gameId}`;
  const leagueId = await leagueOfGame(db, gameId);
  if (!leagueId) notFound();
  const subject = await requirePermissionToChange("referee.availability", {
    next: page,
    leagueId,
  });
  const userId = parseId<UserId>(subject.userId);
  if (!userId) notFound();
  const result = await txDb.transaction((tx) =>
    takeRefereeGame(tx, {
      gameId,
      userId,
      now: new Date(),
      // A ref who plays for one of the teams says so before taking it (#296).
      ownTeamOk: form.get("ownTeamOk") === "on",
    }),
  );
  redirect(result.ok ? `${page}?took=1` : `${page}?error=${result.error}`);
}
