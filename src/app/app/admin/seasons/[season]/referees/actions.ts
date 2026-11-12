"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { assignReferee, unassignReferee } from "@/db/queries/referees";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { type GameId, parseId } from "@/domain/ids";
import { requirePermission } from "@/lib/auth/permission";

const pageFor = (slug: string) => `/app/admin/seasons/${slug}/referees`;

async function context(slug: string, rawGameId: string) {
  const page = pageFor(slug);
  const subject = await requirePermission("referee.manage", { next: page });
  const season = await seasonBySlug(db, slug);
  const gameId = parseId<GameId>(rawGameId);
  if (!season || !gameId) notFound();
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
