# ADR 0008: Serve the schedule, standings and team pages as static HTML

- Status: accepted
- Date: 2026-11-12

## Context

Players open the schedule, standings and team pages more than any others, mostly on phones. Those pages read the database on every request and streamed their content in after the first paint. Lighthouse on a throttled phone scored their Largest Contentful Paint at about 3 seconds whenever the content arrived after the JavaScript had started loading, over the 2-second budget in [design-system.md](../design-system.md#performance-budgets). Two things kept them dynamic: uncached database reads, and the query strings that pick a view (`?team=` on the schedule, `?season=` on a team page), which only exist per request. The team page also read the request's host for its calendar links and the current time for "next game".

## Decision

**Cache the whole page, not each query.** Each page renders inside one `use cache` component tagged `season:{seasonId}` (and `team:{slug}` for a team). The team page's nested components, which read history and stats themselves, run inside that scope too, so no read is left uncached. With Cache Components and Partial Prefetching, Next.js stores the finished page after its first visit and serves it as static HTML from then on. No `generateStaticParams` is needed, so a build still needs no database.

**One lifetime for all three** (`PUBLIC_PAGE_LIFE` in `src/lib/public-cache.ts`): refresh in the background a minute after the last render, and keep serving the stored page for up to a day. A visitor never waits for a refresh unless the page went a whole day without a visit.

**Actions expire what they change.** Publishing a schedule version (which covers rain-outs), reporting or answering a score, and editing a season call `updateTag` for the season, so the person who made the change sees it on the next load. Everything else, such as a roster change or a score that settles after 24 hours, shows within a minute through the background refresh.

**Query strings become path segments.** `src/proxy.ts` rewrites `/seasons/<s>/schedule?team=<t>` to the optional segment `/seasons/<s>/schedule/<t>`, and `/teams/<t>?season=<s>` to `/teams/<t>/<s>`, only for values shaped like slugs. The pages read the segment as a route param, so every view is cacheable, and the address in the browser does not change. Calendar links use the site's configured origin instead of the request's host.

## Alternatives considered

- **Cache each query and keep the page dynamic.** The data would be fast, but the page would still stream after its shell, which is what Lighthouse penalised.
- **Filter the schedule in the browser.** The form would no longer work before JavaScript loads, and the team page's season choice would still need a server render.
- **Prerender every season and team at build time.** Needs the database during every build, including CI's, and the first visit already does the same work.
- **A shorter lifetime, or none with tags only.** Many changes, such as a score settling on its own, have no action to expire a tag, so a time-based refresh is still needed. A day-long expiry keeps the slow path rare.

## Consequences

- The first visit to a page after a deploy, or after a day without visits, is as slow as before. Lighthouse takes the median of three runs, so it measures the cached page.
- A roster change or a score settling by itself can take up to a minute to show. "Next game" on a team page is worked out at render time, so it can be a minute behind.
- An unknown season or team still shows the not-found page, with a 200 status because the response has started streaming by then.
- `/seasons/<s>/schedule/<t>` and `/teams/<t>/<s>` also answer directly. They show the same content as the query-string addresses.
