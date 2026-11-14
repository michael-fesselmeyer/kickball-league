# ADR 0049: Private leagues and tournaments are private seasons

- Status: accepted
- Date: 2026-11-14

## Context

Companies, clubs and groups of friends ask the league to run a one-day tournament or a short league just for them (product spec, section 6: "Corporate and private-event leagues"). The league already has everything such an event needs: field time on its permits, a scheduler, a playoffs bracket, team registration with waivers, Stripe Checkout and its webhook, score reporting and refs. What it must not do is mix the event into the league itself: its teams, games and results can't show on the public site, in the main standings, in league records and history, in stat awards or leaderboards, or in the sitemap.

## Decision

**A private event is a season of the same league marked private.** `season.visibility` is `league` or `private`. A `private_event` row holds the organizer's request and, once an admin accepts it, its season, who pays, the price and the invite token.

- **Requests come from signed-in organizers.** The public "Book a private league or tournament" page is static HTML with a link to a form in the app. Every outbox message needs an account to go to, and the organizer page needs to know who the organizer is, so the requester signs in first; their account holds the contact details, so the request stores none. Requests are limited to three a day per person.
- **The admin accepts a request as a season** open for registration, with as many team spots as were asked for. The admin then adds its field time and builds a round robin with the scheduler or a bracket with the playoffs screen, exactly as for a league season.
- **Teams join only through the invite link.** `/app/private-events/join/<token>` remembers the invite in an HTTP-only cookie and opens the season's registration; registration, the waitlist and new-team requests are a 404 for a private season without it, and private seasons take no free agents. Players then join their team through the team's own invite, as anywhere.
- **Payment uses what exists.** When the organization pays, its teams enter free (a team fee of zero) and the organizer pays the agreed price once through Stripe Checkout, as a `private_event` purchase item that the existing webhook settles. Otherwise each player pays the season's fee as in any season. No Stripe Invoicing or other paid product.
- **One shared filter keeps it out of public reads.** `src/db/queries/season-scope.ts` exports `publicSeasons` (a league season past draft) and `leagueSeasons`. Every public query uses one of them: the published schedule and game pages, team pages and calendar feeds, standings, history and records, the season money page, sponsors, divisions, theme-week links, the sitemap and prerendered season paths, pick'em, the league's sign-up list and the admin dashboard's default season. A player's own home screen and the organizer page read the private season's games through the published schedule's `mine` scope.
- **Organizer page.** The organizer (the request's `organizer_id`) and the league's admins see the teams, schedule, results, payment and invite link at `/app/private-events/<season>`; anyone else gets a 404.

## Alternatives considered

- **Separate tables for private teams and games.** Nothing could leak, but registration, waivers, payments, rosters, scheduling, brackets and scoring would all need a second copy.
- **A separate league per event.** The multi-league work (#311) makes this possible, but each event would need its own fields, waivers and admins, and the league's own owners would lose sight of the revenue in their books.
- **An anonymous request form.** Simpler for the organizer, but the outbox only sends to accounts, and the organizer page would need its own secret link instead of a sign-in.

## Consequences

- A new public query has to choose a scope from `season-scope.ts`; the database tests check the main public reads with a private season present.
- Private seasons appear in the admin's season list and in the owners' books and dashboard, where their income belongs.
- Stat awards, leaderboards and anything else that ranks across seasons must use `leagueSeasons` or `publicSeasons` when it lands.
