# ADR 0055: Permit fees, the 50-hour line and giving time back, worked out from what the app holds

- Status: accepted
- Date: 2026-11-15

## Context

NYC Parks bills adult leagues by the hour. The rate depends on the surface, and lights cost extra. Fees are due 14 days before the season starts. A season with more than 50 permitted hours needs liability insurance naming the City and a notarized broker's form, and the portal takes no more applications until both are approved. Parks gives no refunds, but it asks leagues to give back time they won't use. A permit left unused can be cut back, which costs the league its returning status (docs/permits/nyc-parks.md).

Owners tracked all of this by hand. The app already holds the permit windows, the fields and their venues, the slots a rain-out cancels and the blackout dates (ADR 0034). It doesn't hold a field's surface or lights, or the exact fee.

NYC Parks has no public permit API, and its site answers automated requests with 403 Forbidden. The site must cost nothing to run (ADR 0021).

## Decision

**Fees are estimated, never stored.** Each permit with no cost entered gets an estimate, worked out on every read from:
- its hours, at the adult rate for the field's surface;
- its hours after sunset, at the lights rate.

Sunset is computed in the app with NOAA's solar formulas. That is within about three minutes in New York, with no astronomy service.

The surface comes from the NYC Open Data field snapshot the capacity planner already ships. The app finds the park nearest the venue's pin, within 500 m. It uses the field there with the same name as the league's field. If none matches, it uses the surface every kickball field in that park shares. If that fails too, it assumes natural grass, the surface of most kickball fields, and says so on the screen. The snapshot's surface names match Parks' fee rows one for one.

The estimate shows on the permits screen and as "expected permit fees" in the books, kept apart from the ledger's money out. An entered cost replaces it.

**The 50-hour line counts requested and confirmed windows.** Lost windows don't count. Requested time counts because the warning is for planning: it has to come before the request crosses the line, not after Parks grants it. The screen warns from 40 hours. The request sheet adds the capacity planner's extra games on top of the permits, and treats any other sheet as the whole season's ask.

**Unused time is a window that hasn't started yet** where a rain-out has cancelled every slot, or a blackout covers its date (league-wide or on its field). The screen lists each one with:
- the borough office's phone number, from the borough of the nearest park in the snapshot;
- the answers for Parks' online cancellation form, in the form's order, ready to copy.

Nothing is sent to Parks: owners call or fill in the form themselves.

**Reminders ride the existing daily books job.** No new scheduled job is added:
- The fees due date joins the books deadlines, reminded 30 and 7 days ahead.
- The hours and give-back alerts are a new non-urgent `permit_alert` message on the staff-only `operations` topic. Each is queued once per season and level, or per window and reason, for each owner.

**The openings watcher is not built.** Parks publishes each park's issued permits as a spreadsheet. A daily check could spot open time in the first-come periods. robots.txt allows the path and the terms of use don't forbid it. But the site refuses automated requests, the spreadsheet included, so reading it would mean posing as a browser to get past that. The permits screen links owners to the park's map and spreadsheet instead.

## Alternatives considered

- **Store surface, lights and fee on each field or permit.** That would be exact, but it needs a migration and owners to fill in fields Parks already publishes. The snapshot is right for the fields Parks lists. An owner who knows better enters the real cost, which wins.
- **A sunrise and sunset API.** Free ones exist, but they mean a network call per date and another dependency to budget. The formula is a few lines and needs no network.
- **Count only confirmed windows toward 50 hours.** The warning would come too late to get the insurance in place before asking.
- **Watch the issued-permits spreadsheet anyway, with a browser-like client.** That works around a refusal the site makes on purpose. Out.

## Consequences

- An estimate can be off when a field isn't in the snapshot, or the league's field name doesn't match Parks' name. The screen says which basis it used.
- Leagues outside New York City get NYC rates and no office. The permit helper is for NYC Parks.
- Unused time is spotted from the schedule. A date the league drops without a blackout or a rain-out isn't listed.
- Owners get at most two hours emails per season and one email per window to give back.
