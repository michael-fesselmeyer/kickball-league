"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { gamePeople } from "@/db/queries/discipline";
import { giveCard, undoCard } from "@/db/queries/cards";
import { gameForScoring } from "@/db/queries/scores";
import { can } from "@/domain/authz/permissions";
import { cardChoice, parseCardForm } from "@/domain/discipline/cards";
import { type GameCardId, type GameId, parseId } from "@/domain/ids";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { requireFeature } from "@/lib/platform/site";

/** The game and the viewer, who must be its ref or an admin. */
async function context(rawGameId: string) {
  await requireFeature("discipline");
  const page = `/app/games/${rawGameId}/score`;
  const gameId = parseId<GameId>(rawGameId);
  const g = gameId ? await gameForScoring(db, gameId) : null;
  if (!g) notFound();
  const subject = await requirePermissionToChange("card.give", {
    next: page,
    game: { id: g.id, teamSeasonIds: [g.teamAId, g.teamBId] },
  });
  return { page, g, subject };
}

/** The ref gives a player a yellow or red card. */
export async function giveCardAction(
  rawGameId: string,
  form: FormData,
): Promise<void> {
  const { page, g, subject } = await context(rawGameId);
  const people = await gamePeople(db, g);
  const parsed = parseCardForm(
    formStrings(form, ["color", "note", "person"] as const),
    new Set(people.map((p) => cardChoice(p.teamSeasonId, p.userId))),
  );
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#cards`);
  const given = await giveCard(txDb, {
    gameId: g.id,
    givenBy: subject.userId,
    card: parsed.value,
    now: new Date(),
  });
  if (!given.ok) redirect(`${page}?error=${given.error}#cards`);
  redirect(`${page}?carded=1#cards`);
}

/** Takes a card back: the giver within a few minutes, an admin any time. */
export async function undoCardAction(
  rawGameId: string,
  rawCardId: string,
): Promise<void> {
  const { page, g, subject } = await context(rawGameId);
  const cardId = parseId<GameCardId>(rawCardId);
  if (!cardId) notFound();
  const undone = await undoCard(txDb, {
    cardId,
    gameId: g.id,
    by: subject.userId,
    isAdmin: can(subject, "score.override", {}),
    now: new Date(),
  });
  if (!undone.ok) redirect(`${page}?error=undo_${undone.error}#cards`);
  redirect(`${page}?uncarded=1#cards`);
}
