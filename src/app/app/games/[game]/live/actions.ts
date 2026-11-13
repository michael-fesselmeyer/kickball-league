"use server";

import { updateTag } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  enterHalf,
  hasReferee,
  reportFromInnings,
  setKicksFirst,
  undoLastHalf,
} from "@/db/queries/live-scores";
import { gameForScoring } from "@/db/queries/scores";
import { can } from "@/domain/authz/permissions";
import { isOneOf } from "@/domain/guards";
import { type GameId, parseId } from "@/domain/ids";
import { HALVES } from "@/domain/scores/live";
import { PLAYOFF_TIE } from "@/domain/scores/scores";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { gameTag, refreshSeasonPages } from "@/lib/public-cache";
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
  updateTag(gameTag(g.id));
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
  // A quick-pick button sends its runs; "Save" sends the typed number.
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
  updateTag(gameTag(g.id));
  redirect(page);
}

export async function undoAction(rawGameId: string): Promise<void> {
  const { page, g } = await context(rawGameId);
  const result = await txDb.transaction((tx) =>
    undoLastHalf(tx, { gameId: g.id, now: new Date() }),
  );
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  updateTag(gameTag(g.id));
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
  const team = [g.teamAId, g.teamBId].find((t) =>
    subject.roster.some(
      (m) =>
        m.teamSeasonId === t &&
        (m.role === "captain" || m.role === "co_captain"),
    ),
  );
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
      teamSeasonId: role === "captain" ? (team ?? null) : null,
      ending,
      clientId: clientId.slice(0, 64),
      now: new Date(),
    }),
  );
  if (!result.ok)
    redirect(
      `${page}?error=${typeof result.error === "string" ? result.error : result.error.scoreB === PLAYOFF_TIE ? "playoff_tie" : "invalid"}`,
    );
  updateTag(gameTag(g.id));
  refreshSeasonPages(g.seasonId);
  // The final score goes out for confirmation like any reported score.
  sendQueuedSoon();
  redirect(`/app/games/${g.id}/score?saved=1`);
}
