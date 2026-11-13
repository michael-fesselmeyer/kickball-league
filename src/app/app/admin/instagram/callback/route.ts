import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { currentLeague } from "@/db/queries/seasons";
import { requirePermissionToChange } from "@/lib/auth/permission";
import { PHOTOS_TAG } from "@/lib/public-cache";
import { completeConnection } from "@/lib/social/connect";
import { instagramConfig } from "@/lib/social/instagram-app";
import {
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  statesMatch,
} from "@/lib/social/oauth-state";

const PAGE = "/app/admin/instagram";

/**
 * Where Instagram sends the admin back after signing in
 * (docs/architecture.md, section 17). Checks the state against the cookie
 * set when they left, then finishes connecting (src/lib/social/connect.ts)
 * and returns to the admin screen.
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

  const result = await completeConnection(config, {
    code,
    leagueId: league.id,
    actorId: subject.userId,
  });
  revalidateTag(PHOTOS_TAG, "max");
  redirect(`${PAGE}?${result}`);
}
