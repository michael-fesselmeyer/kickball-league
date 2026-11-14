import { cookies } from "next/headers";
import { db } from "@/db/client";
import { inviteMatches } from "@/db/queries/private-events";
import type { SeasonId } from "@/domain/ids";

/**
 * The private-event invite a captain arrived with (ADR 0049), remembered in
 * a cookie by /app/private-events/join/<token> so the registration screen
 * and its actions can check it without the secret in every form.
 */
export const PRIVATE_INVITE_COOKIE = "kb_private_invite";
export const PRIVATE_INVITE_DAYS = 7;

/** Whether this person may register for the season: always, unless private. */
export async function mayRegister(season: {
  id: SeasonId;
  visibility: "league" | "private";
}): Promise<boolean> {
  if (season.visibility === "league") return true;
  const jar = await cookies();
  return inviteMatches(
    db,
    season.id,
    jar.get(PRIVATE_INVITE_COOKIE)?.value ?? null,
  );
}
