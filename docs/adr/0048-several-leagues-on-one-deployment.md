# ADR 0048: Several leagues on one deployment

- Status: accepted
- Date: 2026-11-14

## Context

One deployment served one league. The data model was ready for more (`league` is the root of seasons, teams, sponsors, events, the books and every league setting), but the code read "the league" as the oldest row, roles were global (`profile.global_role`), and many queries looked records up by a slug that is unique only within a league. A friendly flag football league wants to run alongside the kickball league on the same site, with the same accounts, without either league's people seeing or changing the other's data.

## Decision

**Data.** Every table holds either one league's data or the platform's and its people's. A league's table carries `league_id`, or a required foreign key to a table that does. `purchase`, `credit_entry` and `audit_log` gain `league_id` (league credit pays only that league's fees; each league's owners read only their own audit log). A unit test (`src/db/schema/league-scope.test.ts`) walks the schema's foreign keys and fails when a new table is neither scoped to a league nor listed, with a reason, as the platform's.

**Roles.** `league_member (league_id, user_id, role)` replaces `profile.global_role`; the migration copies existing admins and owners into the default league. A permission subject is loaded for one league: its role, teams, refereed games and managed sponsors are that league's only. `can()` refuses any action whose context names another league. `requirePermission` also checks that a team, game or sponsor in its context belongs to the subject's league. Server Actions that take other record ids call `requireInLeague`, which resolves each record's league through one lookup table (`src/db/queries/league-of.ts`), shared with the audit log.

**Public pages.** One route tree, `src/app/l/[league]`. The default league (`league.is_default`, exactly one) keeps today's URLs: the proxy rewrites `/seasons/...`, `/teams/...` and the other league page roots to the reserved segment `_default`, which no slug can be. Every other league's pages are at `/l/<slug>/...`; `/l/<default slug>/...` redirects to the plain URL. A page takes its league from the path alone, never from a cookie, a header or the query string, so it stays static HTML within its budget. Links go through `leagueHref(league, path)`. The default league's own pages (about, FAQ, the park and the search landing pages) stay where they are.

**The app.** The signed-in app is dynamic, so it remembers the league being shown in a `league` cookie, set by `/app/league/<slug>`, which is also how a league's public pages hand a visitor into the app. Anyone who belongs to more than one league (a role, or a registration) sees a switcher on the app's home. Queries the app runs are scoped by that league.

**The operator.** The console lists the leagues, starts one (name, sport, slug, colors, time zone, minimum age and a first rule set) and sets roles per league. Site status and feature switches stay platform-wide, stored on the default league's row, so pausing the site pauses every league, as ADR 0009 says.

**Jobs.** Scheduled jobs run across leagues: most already worked row by row; the books reminders loop over leagues, and notices to admins go to the admins of the league concerned.

## Consequences

- One account plays in several leagues; credit, roles and the audit log stay apart.
- Cache tags are still global (`sponsors`, `events`, `team:<slug>`), so a change can expire another league's copy of a page too. That costs a re-render, never a stale page.
- The audit log finds the league of most records itself; an entry about a person (`user`) must name its league.
- Pausing one league alone, per-league feature switches and a league's own domain are not built. Each would be a follow-up.
- A merge of two accounts that belong to other leagues needs the operator, since a merge moves everything both accounts hold.

## Alternatives considered

- **A deployment per league.** Simplest isolation, but two of everything on free plans that allow one, and players would need two accounts.
- **The league in a cookie or the query string for public pages.** Breaks static HTML: a page that reads either is rendered on every request.
- **Postgres row-level security keyed on a session setting.** Strong isolation, but the HTTP driver runs each query on its own, with no session to set.
- **Moving the default league under `/l/<slug>` too.** One URL scheme, but every existing link and search result would need a redirect.
