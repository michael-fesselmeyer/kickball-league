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
