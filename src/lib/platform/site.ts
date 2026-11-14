import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/db/client";
import { siteSettings, type SiteSettings } from "@/db/queries/platform";
import {
  type Feature,
  featureOn,
  isOperator,
  parseOperatorIds,
} from "@/domain/platform/operator";
import { logError } from "@/lib/log-error";

/**
 * The platform operator's account ids, from the server's environment only.
 * Read raw, like DEMO_MODE (ADR 0004): it is optional, holds no secret and
 * is never part of a build, so it stays out of the validated schema and
 * `.env.example`. See ADR 0009.
 */
export const operatorIds = () =>
  parseOperatorIds(process.env.OPERATOR_USER_IDS);

export const isCurrentOperator = (userId: string | null) =>
  isOperator(userId, operatorIds());

/**
 * Read on every write and in the proxy, so it is cached briefly in memory.
 * The operator console clears it after a change, so this server sees the
 * change at once; other server instances within a few seconds.
 */
const TTL_MS = 5_000;
let cached: { at: number; value: SiteSettings | null } | null = null;
/** The last settings read, kept through a database outage. */
let lastKnown: SiteSettings | null = null;
let failedAt: number | null = null;

export async function currentSite(): Promise<SiteSettings | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const value = await siteSettings(db);
  cached = { at: now, value };
  lastKnown = value;
  failedAt = null;
  return value;
}

/**
 * The site's settings for the proxy, which runs before every page, the
 * prerendered ones too. When the database can't be reached it answers with
 * the last settings this server read, so a paused site stays paused, or with
 * none (an active site) on a server that never read them, so the pages that
 * need no database still load instead of every page failing. A failure is
 * remembered as long as a success, so an outage doesn't get one more query
 * per request.
 */
export async function siteForProxy(): Promise<SiteSettings | null> {
  if (failedAt !== null && Date.now() - failedAt < TTL_MS) return lastKnown;
  try {
    return await currentSite();
  } catch (error) {
    failedAt = Date.now();
    logError("Site settings unavailable; using the last known", error);
    return lastKnown;
  }
}

export function forgetSite(): void {
  cached = null;
}

/**
 * Whether the operator left `feature` on; on when no league exists yet.
 * Per request, so a page that checks it is never prerendered with a stale
 * answer (and the site cache's clock is never read while prerendering).
 */
export async function featureEnabled(feature: Feature): Promise<boolean> {
  await connection();
  const site = await currentSite();
  return site === null || featureOn(site.disabledFeatures, feature);
}

/**
 * Scheduled jobs change data and send email, so they wait while the site is
 * read-only or paused. Returns the response to send, or null to go on.
 */
export async function refuseJobsWhileFrozen(): Promise<Response | null> {
  const site = await currentSite();
  if (!site || site.status === "active") return null;
  return Response.json(
    { skipped: `The site is ${site.status.replace("_", "-")}` },
    { status: 200 },
  );
}

/** For a feature's pages and actions: not found while the operator has it off. */
export async function requireFeature(feature: Feature): Promise<void> {
  if (!(await featureEnabled(feature))) notFound();
}
