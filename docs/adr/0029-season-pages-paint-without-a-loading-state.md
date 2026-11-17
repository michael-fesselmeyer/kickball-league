# ADR 0029: Season pages paint without a loading state

- Status: accepted
- Date: 2026-11-13

## Context

The public schedule, standings and team pages are prerendered for every public season and team. Each page wrapped its content in a `<Suspense>` boundary with a loading state, so a view the build didn't list (a team-filtered schedule, another season's team page) could stream in behind it.

The prerendered pages still reached the browser in streaming form. React moves a finished Suspense boundary to the end of the document when it doesn't fit in the rest of its 12.8 kB progressive chunk. The schedule's content is about 108 kB of HTML, the standings' about 50 kB and a team's about 65 kB, so the HTML held the loading state first and the content in a hidden segment after it. When the browser painted before it reached the script that swaps the content in, the first paint was "Loading the schedule…". React then held the content back until 300 ms after that paint. Lighthouse saw this in 10 of 145 CI runs of the schedule: the `h1` painted 280–310 ms after the first contentful paint (#229). A phone parsing that much HTML is more likely to paint early than a CI runner.

## Decision

**The three pages render their content without a Suspense boundary and set `ensureStatic = "navigation"`.**

- With no boundary around it, the content is part of the shell, so the first paint is the page itself.
- `ensureStatic = "navigation"` makes Next.js produce the whole route as static output. A view the build didn't list is rendered in full on its first request and stored for later requests, instead of serving the route's fallback shell. Next.js also checks at build time that nothing on these routes reads cookies, headers or uncached data.
- The 404 for an unknown season or team is unchanged.

## Alternatives considered

- **Move only the header out of the boundary.** The heading would paint at once, but the schedule itself would still arrive up to 300 ms later, and the later list would become the page's largest paint.
- **Raise React's progressive chunk size.** Next.js doesn't expose it, and it would change streaming for every page.
- **Several small boundaries.** Each one counts against the same 12.8 kB chunk, so most of the schedule would still be moved.

## Consequences

- The first visit to an unlisted view waits for its render (about 70–220 ms locally) instead of showing a loading state first. Every later visit gets the stored page. Listed views are unchanged and were already static.
- A cookie, header or uncached read added anywhere on these routes fails the build instead of quietly making them dynamic.
- After a publish, `refreshSeasonPages` still expires these routes by path ([ADR 0018](0018-expire-season-routes-by-path.md)), and the end-to-end publish flow still checks that the next visitor sees the new schedule.

## Update: the game page (2026-11-14)

The public game page (`/games/[game]`) had the same problem with a smaller page: its content, a dynamic hole behind "Loading the game…", lost the race to the first paint in about 2 of 5 Lighthouse runs, and in every run once the security headers (ADR 0044) added a few hundred bytes to each response (#310). It now follows this decision: no boundary around the game, `generateStaticParams` for the games of seasons still being played, and cached reads, including a long-lived copy of the line score that each live-scoring change expires with the page (`refreshGamePage`); the stats panel is cached as the team page's is, so its game of the week is worked out when the copy is made. It can't set `ensureStatic = "navigation"`, because the forecast and the photo prompt read the clock and the site's feature switches per request; they stay in small boundaries of their own below the date. Instead it sets `instant = false`, so a game the build didn't list, or one whose page was just expired, is rendered in full before it is served rather than from a generic fallback (with Partial Prefetching, the runtime render otherwise fails on the game id read outside a boundary). Because a visitor may get a copy of the page from before the latest half-inning, the live score asks the live route once as soon as it loads, before following its usual polling rules.

## Update: the paused notice (2026-11-14)

`/paused` showed "Loading…" while it read the site's status per request, and lost the same race in about half of its Lighthouse runs (#347). It now reads the league's name and status in one cached read tagged `site`, which the operator's status change expires along with the page (`refreshSiteNotice`), and sets `ensureStatic = "navigation"`.


## Update: the event page (2026-11-17)

The public event page (`/events/[event]`) wrapped the whole event in a boundary behind "Loading the event…". A tournament's page is large enough that React moved the finished event to the end of the document and revealed it with an inline script, so the description, the page's largest paint, waited on that script. Lighthouse measured it at about 1.1 s in some runs and 3.6 s in others against the 2.0 s budget, depending on whether its model ordered the reveal after the framework's scripts. The page now follows this decision: no boundary around the event and `ensureStatic = "navigation"`. Everything it reads is cached by the event's tag and the photo tags, so every event is prerendered as fully static HTML with the event in the first paint, and an event the build didn't list is rendered in full on its first visit. The park page (`/fields/[park]`), the sponsors list and each sponsor's page had the same page-level boundary and missed the same budget on slow runners; they follow this decision too. The park page now keeps a lookup that finds no park for the page's usual life instead of reading it on every request, since a fully static route can't hold request-time data; adding a park expires the `parks` tag, and an unknown park now answers 404 instead of a 200 page that says it wasn't found. The events list still uses a boundary: until a build has a league, it keeps nothing, so its first real visit reads the database, and that needs its own change.
