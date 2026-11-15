"use server";

import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { gameInLeague, submitConcern } from "@/db/queries/concerns";
import { PLAYER_CATEGORIES, parseConcern } from "@/domain/concerns/concerns";
import { type GameId, parseId } from "@/domain/ids";
import { allowAction } from "@/lib/action-limit";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { formStrings } from "@/lib/form";
import { activeLeague } from "@/lib/league/active";
import { sendQueuedSoon } from "@/services/outbox";

const NEW = "/app/concerns/new";

/** A game link or id: the last uuid in what was pasted. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Any signed-in player sends a private concern. It goes to the league's
 * admins only: not to a team, a captain or any public page. The reply
 * comes in the app and by email at the account's address.
 */
export async function sendConcernAction(form: FormData): Promise<void> {
  const subject = await requirePermissionToChange("concern.send", {
    next: NEW,
  });
  const raw = formStrings(form, [
    "category",
    "parkRule",
    "body",
    "game",
  ] as const);
  const now = new Date();
  const parsed = parseConcern(
    {
      ...raw,
      occurredOn: "",
      place: "",
      replyEmail: "",
    },
    Object.keys(PLAYER_CATEGORIES),
    now.toISOString().slice(0, 10),
  );
  if (!parsed.ok) redirect(`${NEW}?error=${parsed.error}`);
  const league = await activeLeague();
  if (!league) redirect(`${NEW}?error=league`);
  let gameId: GameId | null = null;
  const pasted = raw.game.trim();
  if (pasted !== "") {
    const found = pasted.match(UUID)?.at(-1);
    gameId = found ? parseId<GameId>(found) : null;
    if (!gameId || !(await gameInLeague(db, gameId, league.id)))
      redirect(`${NEW}?error=game`);
  }
  if (!(await allowAction("concern", subject.userId)))
    redirect(`${NEW}?error=limit`);
  const id = await submitConcern(txDb, {
    leagueId: league.id,
    leagueName: league.name,
    source: "player",
    senderId: subject.userId,
    gameId,
    form: parsed.value,
    now,
  });
  sendQueuedSoon();
  redirect(`/app/concerns/${id}?notice=sent`);
}
