# ADR 0047: Queries wait for a real request

- Status: accepted
- Date: 2026-11-14

## Context

With `partialPrefetching: true`, every request for a dynamic page made twice the database queries it needed (#267). Next.js 16.4 renders such a page, waits until its `use cache` reads are filled, and then runs a second render in parallel: a runtime prerender of the route's App Shell, embedded in the response so the browser can cache it for later navigations.

A prerender keeps only static output and `use cache` results. Everything behind an uncached read is cut off when it ends, so a query sent during it is paid for and its answer thrown away. Every signed-in screen starts with the session lookup and the permission check, which are uncached, so every one of their queries was sent twice. React's `cache()` can't share results between two renders.

On Neon's HTTP driver each query is a round trip, and compute time counts against the free plan ([ADR 0021](0021-free-services-only.md)).

## Decision

**Every query waits for a real request.** Both database clients send each statement through `query`, and `src/db/wait-for-request.ts` makes that wait on Next.js's `io()` first. `io()` stops a prerender at that point, and when the prerender ends its promise rejects, so the query is never sent. In a real request it resolves as soon as the render reaches its request-time stage, inside a `use cache` scope it resolves at once, and outside Next.js (scripts, tests, jobs) it does nothing.

Partial Prefetching and Cached Navigations stay on. The App Shell the second render produces is the same as before: it never had the uncached data in it.

## Alternatives considered

- **Turn Partial Prefetching off.** It ends the second render, but public pages would go back to prefetching each link separately, and the option goes away in the next major version, when Partial Prefetching is always on ([ADR 0008](0008-static-public-pages.md), [ADR 0018](0018-expire-season-routes-by-path.md)).
- **Turn off `experimental.cachedNavigations`.** Also ends the second render, but the browser no longer caches the static part of a page it just loaded, and it is an experimental flag that becomes the default.
- **`connection()` in the session lookup only.** It covers the signed-in screens, but not a query that doesn't depend on the session, and `connection()` throws inside a `use cache` scope, so it can't go in the shared database client.

## Consequences

- A signed-in page, and a public page rendered on request, makes one render's worth of queries.
- A query outside `use cache` on a prerendered page is never sent at build time either, so a build still needs no database.
- In a real request, an uncached query now starts when the render reaches its request-time stage instead of when a component first asks. They are a few task ticks apart.
- Statements inside a transaction run on a connection from `connect()` and aren't held. Transactions run only in Server Actions, Route Handlers and jobs. Drizzle's `db.batch()` on the HTTP driver would need the driver's own lazy query objects, so it isn't used.
