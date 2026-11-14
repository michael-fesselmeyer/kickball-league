import { db } from "@/db/client";
import { turnOffEmailTopic } from "@/db/queries/notifications";
import { env } from "@/env";
import { readUnsubscribeToken } from "@/lib/unsubscribe";

/**
 * A mail app's one-click unsubscribe (RFC 8058): every league email names
 * this address in its List-Unsubscribe header, and the app posts
 * "List-Unsubscribe=One-Click" here when the person taps its button. The
 * signed token is the key (src/lib/unsubscribe.ts), so nobody has to sign
 * in. Only a POST changes anything; a GET, as a link scanner sends, does not.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/unsubscribe/[token]">,
) {
  const { token } = await ctx.params;
  const found = readUnsubscribeToken(env.BETTER_AUTH_SECRET, token);
  if (!found)
    return new Response("This unsubscribe link isn't valid.", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  await turnOffEmailTopic(db, found.userId, found.topic);
  return new Response("Unsubscribed.", {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
