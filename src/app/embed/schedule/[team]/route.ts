import { env } from "@/env";
import { siteOrigin } from "@/lib/site";
import { NO_TEAM, publicTeamParams } from "@/lib/static-params";
import { teamWidgetPage } from "@/lib/widget/data";
import { notFoundWidgetHtml, WIDGET_HEADERS } from "@/lib/widget/embed-html";

/** Every public team's widget is prerendered, like its team page. */
export async function generateStaticParams() {
  return publicTeamParams();
}

/**
 * A team's schedule widget: its next games as one small HTML page with no
 * script, for a sponsor's or the team's own site to frame.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/embed/schedule/[team]">,
) {
  const { team: slug } = await ctx.params;
  const html = slug === NO_TEAM ? null : await teamWidgetPage(slug);
  if (html === null)
    return new Response(notFoundWidgetHtml(siteOrigin(env.BETTER_AUTH_URL)), {
      status: 404,
      headers: WIDGET_HEADERS,
    });
  return new Response(html, { headers: WIDGET_HEADERS });
}
