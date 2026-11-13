import { txDb } from "@/db/client";
import { connectedAccounts, saveConnection } from "@/db/queries/social";
import type { LeagueId, UserId } from "@/domain/ids";
import { env } from "@/env";
import { exchangeCode, profile } from "@/services/instagram";
import { type InstagramConfig, redirectUri } from "./instagram-app";
import { syncAccount } from "./sync";

/**
 * Finishes connecting once Instagram has handed back a sign-in code: turns
 * it into a long-lived token, reads the account, saves the token encrypted
 * and runs the first sync. Returns the admin screen's query string.
 */
export async function completeConnection(
  config: InstagramConfig,
  input: { code: string; leagueId: LeagueId; actorId: UserId },
): Promise<string> {
  const now = new Date();
  const token = await exchangeCode(
    config,
    { code: input.code, redirectUri: redirectUri() },
    now,
  );
  if (!token.ok) return "error=sign_in";
  const account = await profile(config, token.value.accessToken);
  if (!account.ok) return "error=sign_in";
  await txDb.transaction((tx) =>
    saveConnection(tx, {
      leagueId: input.leagueId,
      profile: account.value,
      token: token.value,
      secret: env.BETTER_AUTH_SECRET,
      actorId: input.actorId,
      now,
    }),
  );
  const connected = (
    await connectedAccounts(txDb, env.BETTER_AUTH_SECRET, now)
  ).find((a) => a.leagueId === input.leagueId);
  const outcome = connected
    ? await syncAccount(txDb, config, connected, now)
    : null;
  return outcome && "added" in outcome
    ? `done=connected&added=${outcome.added}`
    : "done=connected";
}
