"use server";

import { notFound, redirect } from "next/navigation";
import { txDb } from "@/db/client";
import {
  answerMoveInvite,
  setMoveInterest,
  withdrawMoveInterest,
} from "@/db/queries/move";
import { type MoveInviteId, parseId } from "@/domain/ids";
import { readAudience, readNote } from "@/domain/move/move";
import { requireSelfToChange } from "@/lib/auth/permission";
import { activeLeagueId } from "@/lib/league/active";
import { sendQueuedSoon } from "@/services/outbox";

const PAGE = "/app/change-team";
function done(code: string): never {
  redirect(`${PAGE}?done=${code}#status`);
}

async function context() {
  const subject = await requireSelfToChange("move.set", PAGE);
  const leagueId = await activeLeagueId();
  if (!leagueId) notFound();
  return { userId: subject.userId, leagueId };
}

/** Says, or changes, that the person is open to a new team next season. */
export async function saveMoveAction(form: FormData): Promise<void> {
  const { userId, leagueId } = await context();
  const audience = readAudience(form.get("audience"));
  if (!audience) done("pick_audience");
  const note = readNote(form.get("note"));
  if (!note.ok) done(note.error);
  await txDb.transaction((tx) =>
    setMoveInterest(tx, {
      userId,
      leagueId,
      audience,
      note: note.value,
      now: new Date(),
    }),
  );
  done("saved");
}

/** Takes it back, with every invite it got. Nobody is told. */
export async function withdrawMoveAction(): Promise<void> {
  const { userId, leagueId } = await context();
  await txDb.transaction((tx) => withdrawMoveInterest(tx, userId, leagueId));
  done("withdrawn");
}

/** The person's yes or no to one team's invite. */
export async function answerInviteAction(
  rawId: string,
  accept: boolean,
): Promise<void> {
  const { userId } = await context();
  const id = parseId<MoveInviteId>(rawId);
  if (!id) notFound();
  const result = await txDb.transaction((tx) =>
    answerMoveInvite(tx, { id, userId, accept, now: new Date() }),
  );
  if (!result.ok) done(result.error);
  if (accept) sendQueuedSoon();
  done(accept ? "accepted" : "declined");
}
