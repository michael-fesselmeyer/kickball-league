import { leagueWidgetPage } from "@/lib/widget/data";
import { WIDGET_HEADERS } from "@/lib/widget/embed-html";

/**
 * The league's schedule widget: its next game day as one small HTML page
 * with no script, for other sites to frame (docs/information-architecture.md).
 * Static: the cached page is served as a file and refreshed in the background.
 */
export async function GET() {
  return new Response(await leagueWidgetPage(), { headers: WIDGET_HEADERS });
}
