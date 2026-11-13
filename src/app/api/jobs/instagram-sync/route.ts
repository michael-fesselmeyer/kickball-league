import { txDb } from "@/db/client";
import { env } from "@/env";
import { refuseUnlessCron } from "@/lib/jobs";
import { refuseJobsWhileFrozen } from "@/lib/platform/site";
import { refreshPhotoPagesInBackground } from "@/lib/public-cache";
import { instagramConfig } from "@/lib/social/instagram-app";
import { syncAll } from "@/lib/social/sync";
import { drainOutboxNow } from "@/services/outbox";

/**
 * Copies new posts from the connected Instagram account and removes those
 * deleted there (docs/architecture.md, section 17). Off when Instagram is
 * not configured. Safe to run twice: a post is stored once, and curation is
 * never overwritten. Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessCron(request, env.CRON_SECRET);
  if (refused) return refused;
  const frozen = await refuseJobsWhileFrozen();
  if (frozen) return frozen;
  const config = instagramConfig();
  if (!config) return Response.json({ skipped: "Instagram is not set up" });
  const now = new Date();
  const outcomes = await syncAll(txDb, config, env.BETTER_AUTH_SECRET, now);
  if (outcomes.some((o) => "added" in o && (o.added > 0 || o.removed > 0)))
    refreshPhotoPagesInBackground();
  // A refused token queues a reconnect notice for the admins.
  const delivery = outcomes.some((o) => "error" in o)
    ? await drainOutboxNow(now)
    : null;
  return Response.json({ accounts: outcomes, delivery });
}
