import { txDb } from "@/db/client";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { instagramConfig } from "@/lib/social/instagram-app";
import { refreshAll } from "@/lib/social/sync";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Weekly: extends the Instagram token, which lasts about 60 days. If
 * Instagram refuses it, admins are emailed to reconnect and the synced
 * photos stay up. Safe to run twice: a token less than a day old is left
 * alone, and each admin is told once per connection.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const config = instagramConfig();
  if (!config) return Response.json({ skipped: "Instagram is not set up" });
  const now = new Date();
  const accounts = await refreshAll(txDb, config, env.BETTER_AUTH_SECRET, now);
  const delivery = accounts.some((a) => a.error)
    ? await drainOutboxNow(now)
    : null;
  return Response.json({ accounts, delivery });
}
