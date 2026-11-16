"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  enterHalf,
  hasReferee,
  reportFromInnings,
  setKicksFirst,
  undoLastHalf,
} from "@/db/queries/live-scores";
import { ejectPlayer } from "@/db/queries/discipline";
import { recordStart, setHeldUpBy, undoStart } from "@/db/queries/game-start";
import { gameForScoring } from "@/db/queries/scores";
import { ejectionDetails } from "@/domain/discipline/discipline";
import { requireFeature } from "@/lib/platform/site";
import { can } from "@/domain/authz/permissions";
import { isOneOf } from "@/domain/guards";
import { type GameId, parseId, type UserId } from "@/domain/ids";
import { HALVES } from "@/domain/scores/live";
import {
  CALL_REASONS,
  PLAYOFF_TIE,
  reportingTeam,
} from "@/domain/scores/scores";
import { HELD_UP_BY } from "@/domain/gameday/daylight";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { refreshGamePage, refreshSeasonPages } from "@/lib/public-cache";
import { sendQueuedSoon } from "@/services/outbox";

const pageFor = (gameId: string) => `/app/games/${gameId}/live`;

/** The game and the scorer, or a 404 for anyone who may not score it live. */
async function context(rawGameId: string) {
  const gameId = parseId<GameId>(rawGameId);
  const page = pageFor(rawGameId);
  const subject = await requirePermissionToChange("public.view", {
    next: page,
  });
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const game = {
    id: g.id,
    teamSeasonIds: [g.teamAId, g.teamBId] as const,
    hasReferee: await hasReferee(db, g.id),
  };
  if (!can(subject, "score.live", { game })) notFound();
  return { page, subject, g };
}

/** A whole number from a form field, or NaN, which the checks refuse. */
const integer = (value: unknown) =>
  typeof value === "string" && /^\d{1,3}$/.test(value.trim())
    ? Number(value)
    : Number.NaN;

export async function kicksFirstAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { page, g } = await context(rawGameId);
  const side = form.get("side");
  if (side !== "A" && side !== "B") redirect(`${page}?error=invalid`);
  const result = await txDb.transaction((tx) =>
    setKicksFirst(tx, { gameId: g.id, side, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshGamePage(g.id, await activeLeague());
  redirect(page);
}

export async function saveHalfAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, g } = await context(rawGameId);
  // The next half sends its inning and half; a correction sends both as
  // one "inning:half" choice.
  const position = form.get("position");
  const [inning, half] =
    typeof position === "string"
      ? position.split(":")
      : [form.get("inning"), form.get("half")];
  // "End half" sends the runs counted; "Save" sends the typed number.
  const runs = form.has("runs")
    ? integer(form.get("runs"))
    : integer(form.get("typedRuns"));
  if (!isOneOf(HALVES, half)) redirect(`${page}?error=invalid`);
  const result = await txDb.transaction((tx) =>
    enterHalf(tx, {
      gameId: g.id,
      userId: subject.userId,
      inning: integer(inning),
      half,
      runs,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshGamePage(g.id, await activeLeague());
  redirect(page);
}

export async function undoAction(rawGameId: string): Promise<void> {
  const { page, g } = await context(rawGameId);
  const result = await txDb.transaction((tx) =>
    undoLastHalf(tx, { gameId: g.id, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  refreshGamePage(g.id, await activeLeague());
  redirect(page);
}

/**
 * Ends the game from its innings: the final score goes in as a report, so
 * the captains confirm it on the score screen as usual.
 */
export async function endGameAction(
  rawGameId: string,
  clientId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, g } = await context(rawGameId);
  const ending = form.get("ending");
  if (ending !== "normal" && ending !== "called")
    redirect(`${page}?error=invalid`);
  const reason = form.get("callReason");
  const callReason = isOneOf(CALL_REASONS, reason) ? reason : null;
  const role = can(subject, "score.override")
    ? "admin"
    : subject.refereeGameIds.includes(g.id)
      ? "referee"
      : "captain";
  const result = await txDb.transaction((tx) =>
    reportFromInnings(tx, {
      gameId: g.id,
      userId: subject.userId,
      role,
      teamSeasonId: reportingTeam(role, subject.roster, [g.teamAId, g.teamBId]),
      ending,
      callReason: ending === "called" ? callReason : null,
      clientId: clientId.slice(0, 64),
      now: new Date(),
    }),
  );
  if (!result.ok)
    redirect(
      `${page}?error=${typeof result.error === "string" ? result.error : result.error.scoreB === PLAYOFF_TIE ? "playoff_tie" : "invalid"}`,
    );
  refreshGamePage(g.id, await activeLeague());
  refreshSeasonPages(g.seasonId);
  // The final score goes out for confirmation like any reported score.
  sendQueuedSoon();
  redirect(`/app/games/${g.id}/score?saved=1`);
}

/**
 * The game's ref (or an admin) ejects a player: files an ejection report
 * and takes them out of their team's kicking order for the rest of the game.
 */
export async function ejectAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  await requireFeature("discipline");
  const page = pageFor(rawGameId);
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermissionToChange("player.eject", {
    next: page,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] as const },
  });
  const person = parseId<UserId>(String(form.get("person") ?? ""));
  if (!person) redirect(`${page}?error=no_person#eject`);
  // An ejection files a report and changes the kicking order: confirm first.
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm#eject`);
  const details = ejectionDetails(String(form.get("reason") ?? ""));
  if (!details.ok) redirect(`${page}?error=${details.error}#eject`);
  const result = await ejectPlayer(txDb, {
    gameId: g.id,
    userId: person,
    reportedBy: subject.userId,
    role: subject.refereeGameIds.includes(g.id) ? "referee" : "admin",
    details: details.value,
    now: new Date(),
  });
  if (!result.ok) redirect(`${page}?error=${result.error}#eject`);
  redirect(`${page}?notice=ejected#eject`);
}

/** First pitch, with one tap: the clock counts down to the end of play from here (#467). */
export async function startAction(rawGameId: string): Promise<void> {
  const { page, subject, g } = await context(rawGameId);
  const result = await txDb.transaction((tx) =>
    recordStart(tx, { gameId: g.id, userId: subject.userId, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=start_${result.error}`);
  redirect(page);
}

/** Takes back a first pitch tapped by mistake. */
export async function undoStartAction(rawGameId: string): Promise<void> {
  const { page, g } = await context(rawGameId);
  const result = await txDb.transaction((tx) =>
    undoStart(tx, { gameId: g.id, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=start_${result.error}`);
  redirect(page);
}

/** Who held up a late start, for the punctuality log. */
export async function heldUpAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { page, subject, g } = await context(rawGameId);
  const heldUpBy = form.get("heldUpBy");
  if (!isOneOf(HELD_UP_BY, heldUpBy)) redirect(`${page}?error=invalid`);
  const result = await txDb.transaction((tx) =>
    setHeldUpBy(tx, {
      gameId: g.id,
      heldUpBy,
      userId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) redirect(`${page}?error=start_${result.error}`);
  redirect(page);
}
