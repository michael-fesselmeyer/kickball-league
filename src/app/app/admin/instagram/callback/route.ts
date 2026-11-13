import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { connectedAccounts, saveConnection } from "@/db/queries/social";
import { env } from "@/env";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { PHOTOS_TAG } from "@/lib/public-cache";
import { instagramConfig, redirectUri } from "@/lib/social/instagram-app";
import {
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  statesMatch,
} from "@/lib/social/oauth-state";
import { syncAccount } from "@/lib/social/sync";
import { exchangeCode, profile } from "@/services/instagram";

const PAGE = "/app/admin/instagram";

/**
 * Where Instagram sends the admin back after signing in
 * (docs/architecture.md, section 17). Checks the state against the cookie
 * set when they left, turns the code into a long-lived token, saves it
 * encrypted and runs the first sync, then returns to the admin screen.
 * Nothing from Instagram is ever echoed back into the page.
 */
export async function GET(request: Request): Promise<Response> {
  const subject = await requirePermissionToChange("photos.manage", {
    next: PAGE,
  });
  const query = new URL(request.url).searchParams;
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH });
  if (!statesMatch(expected, query.get("state")))
    redirect(`${PAGE}?error=state`);
  if (query.get("error")) redirect(`${PAGE}?error=denied`);
  const code = query.get("code");
  if (!code) redirect(`${PAGE}?error=denied`);

  const config = instagramConfig();
  const league = await currentLeague(db);
  if (!config || !league) redirect(`${PAGE}?error=off`);

  const now = new Date();
  const token = await exchangeCode(
    config,
    { code, redirectUri: redirectUri() },
    now,
  );
  if (!token.ok) redirect(`${PAGE}?error=sign_in`);
  const account = await profile(config, token.value.accessToken);
  if (!account.ok) redirect(`${PAGE}?error=sign_in`);

  await txDb.transaction((tx) =>
    saveConnection(tx, {
      leagueId: league.id,
      profile: account.value,
      token: token.value,
      secret: env.BETTER_AUTH_SECRET,
      actorId: subject.userId,
      now,
    }),
  );
  const connected = (
    await connectedAccounts(txDb, env.BETTER_AUTH_SECRET, now)
  ).find((a) => a.leagueId === league.id);
  const outcome = connected
    ? await syncAccount(txDb, config, connected, now)
    : null;
  revalidateTag(PHOTOS_TAG, "max");
  redirect(
    outcome && "added" in outcome
      ? `${PAGE}?done=connected&added=${outcome.added}`
      : `${PAGE}?done=connected`,
  );
}
