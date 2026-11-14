const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The public pages pick a view with a query string: `/seasons/<s>/schedule?team=<t>`
 * filters the schedule to a team, `/teams/<t>?season=<s>` shows another
 * season, and `/seasons/<s>/bracket?view=list` lists the bracket. A page that reads the query string is rendered on every request,
 * so src/proxy.ts rewrites these to an optional path segment the page reads
 * as a route param instead, and each view can be served as static HTML
 * (docs/architecture.md, section 3). The address in the browser stays the same.
 *
 * Returns the path to render, or null to render the request as it is.
 */
export function viewRewrite(
  pathname: string,
  search: URLSearchParams,
): string | null {
  const schedule = /^\/seasons\/([^/]+)\/schedule\/?$/.exec(pathname);
  if (schedule) {
    const team = search.get("team") ?? "";
    return SLUG.test(team) ? `/seasons/${schedule[1]}/schedule/${team}` : null;
  }
  const bracket = /^\/seasons\/([^/]+)\/bracket\/?$/.exec(pathname);
  if (bracket) {
    return search.get("view") === "list"
      ? `/seasons/${bracket[1]}/bracket/list`
      : null;
  }
  const team = /^\/teams\/([^/]+)\/?$/.exec(pathname);
  if (team) {
    const season = search.get("season") ?? "";
    return SLUG.test(season) ? `/teams/${team[1]}/${season}` : null;
  }
  return null;
}
