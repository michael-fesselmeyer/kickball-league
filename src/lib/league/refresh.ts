import { revalidatePath, updateTag } from "next/cache";
import { LEAGUES_TAG } from "./public";

/**
 * From a Server Action: after the operator adds or changes a league, every
 * league's public pages read the league list again (ADR 0048).
 */
export function refreshLeaguePages(): void {
  updateTag(LEAGUES_TAG);
  revalidatePath("/l/[league]", "layout");
}
