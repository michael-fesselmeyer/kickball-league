import { updateTag } from "next/cache";
import { refreshSeasonPages } from "./public-cache";

/**
 * How long the owner dashboard's numbers are kept between reads
 * (docs/architecture.md, section 3). They come from many places (payments
 * arrive by webhook, waivers are signed, people check in at bars), so
 * rather than every one of those expiring it, the numbers refresh at most
 * five minutes after a visit, the actions an owner expects to see at once
 * expire the tag, and the page has a button to refresh now. The season tags
 * the public pages use expire it too.
 */
export const OWNER_DASHBOARD_LIFE = {
  stale: 60,
  revalidate: 300,
  expire: 3_600,
} as const;

export const OWNER_DASHBOARD_TAG = "owner-dashboard";

/** From a Server Action: the dashboard reads fresh numbers on its next visit. */
export function refreshOwnerDashboard(): void {
  updateTag(OWNER_DASHBOARD_TAG);
}

/**
 * From a Server Action: a season's money summary was published or taken
 * down. Its public page and the season's other pages (the route is under
 * /seasons/[season]) render fresh, and so does the dashboard.
 */
export function refreshMoneySummary(seasonId: string): void {
  refreshSeasonPages(seasonId);
  refreshOwnerDashboard();
}
