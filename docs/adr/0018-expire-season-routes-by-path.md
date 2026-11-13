# ADR 0018: Expire the season and team routes by path when a season changes

- Status: accepted
- Date: 2026-11-13

## Context

Production builds read the league's database, so every public season's schedule and standings and every team's page are prerendered (`src/lib/static-params.ts`). An action that changes a season (publishing a schedule, a final score, a season edit) expired the `season:{id}` tag, which [ADR 0008](0008-static-public-pages.md) relied on to show the change on the next load.

For a prerendered page that is not enough. Once its tag expires, Next.js answers the next request from the route's shell, the prerendered part served at once while the rest renders, and resumes the render with the cached data saved in that shell. The build fills each shell with the data of a full page of the same route: each season's schedule shell, each team's page shell, and the generic schedule, standings and team shells. That data carries the season tag, but the shell lists only its path tags, and the resumed render checks the data only against tags expired in the same request. So the first visitor after an admin published Spring 2027's schedule saw "Coming soon" from the build, while a fresh copy was made in the background (#202). The end-to-end check never saw it because its build read an empty database.

## Decision

**`refreshSeasonPages` also expires the routes by path.** After `updateTag` for the season, it calls `revalidatePath` with `"layout"` for `/seasons/[season]` and `/teams/[team]`. Every page and shell under those routes carries those path tags, so the shells are rebuilt from fresh data on the next visit. Like `updateTag`, `revalidatePath` from a Server Action expires at once.

**The end-to-end build reads the seeded league**, as production does, so the flows run against prerendered pages. The schedule flow checks that a visitor sees "Coming soon" before publishing and the games on the first load after.

## Alternatives considered

- **Tags only, and wait for a fix in Next.js.** The first visitor after every published schedule or final score would see the old page, on the pages players open most.
- **Put the season tag on each shell.** The shells for a whole route, and the generic ones, cannot know which season's data the build saved in them, and it would depend on details of how shells are built.
- **Stop prerendering, or turn off Partial Prefetching.** Both give up the static first paint that ADR 0008 exists for.

## Consequences

- A season change makes every season's and team's public page render again on its next visit, a few queries each, not only the changed season's. Season changes are a handful a day outside game nights, so this stays cheap.
- The person who made the change, and everyone else, sees it on their first load.
- If Next.js starts checking resumed data against expired tags, the path expiry can go and the tag alone is enough again. The schedule flow will keep proving it either way.
