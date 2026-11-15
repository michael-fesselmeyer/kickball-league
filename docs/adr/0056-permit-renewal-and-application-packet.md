# ADR 0056: Permit renewal drafted from last season, and an application packet

- Status: accepted
- Date: 2026-11-15

## Context

NYC Parks gives a returning adult league first claim on the fields and hours it held the year before, if it asks during the renewal period. Asking for different hours or more fields makes the change a new request, and folding extra time into a renewal risks the league's returning status (Rule 2-12, (a) and (b)(7); docs/permits/nyc-parks.md). Owners rebuilt each renewal by hand from old permits. They also gathered, each time, what Parks' organization review and borough offices may ask for: the website, the schedule, the rosters and the insurance certificate.

NYC Parks has no public permit API, so nothing can be filed for the league. The site must cost nothing to run (ADR 0021).

## Decision

**The calendar lives in the domain.** `src/domain/permits/calendar.ts` holds NYC Parks' three play periods: spring and summer, fall, and winter, which crosses the new year. Each has its renewal, new-request and first-come dates, from Parks' web page.

**The renewal is drafted from a season's held windows:**
- Held means the confirmed windows, or the requested ones when none are marked confirmed. Lost windows are never renewed.
- Windows are grouped by field, local weekday and local hours.
- Each date moves 52 weeks on, so it keeps its weekday. That lands a day or two earlier in the year, so a date that would slip out of the target period moves a week to stay in it.
- A date that wasn't in last year's period isn't moved into this year's. The screen counts those dates.

The target is the same play period a year on, found from the season's first held date.

**Changes are split, never merged.** Owners change the draft with a plain GET form: keep or drop each pattern, its hours, and one added field and day. The rules:
- Every kept pattern renews with the hours it was held.
- Wanted time outside those hours becomes a separate new request on the same dates.
- An added field or day becomes a new request over the renewal's weeks.
- Shortened, shifted or dropped time is flagged, with what it costs.
- The screen warns past Parks' 50-hour weekly renewal cap.

The renewal and the new request are separate sheets to copy.

**The renewal reminder joins the books deadlines.** It is a `renewal_opens` reminder 30 and 7 days before the target's renewal period, sent through the daily books job. Finished seasons count, since last year's season is the one being renewed.

**The packet is read on demand, never stored:**
- the league's name and the site's address;
- the schedule and roster counts;
- the request sheet, split into one application per borough;
- the newest insurance certificate.

The request sheet comes from the permits screen's query string, so the packet carries the sheet the owner worked out. A field's borough is the borough of the nearest NYC Parks field in the Open Data snapshot, within 500 m of its venue.

Player names come only when an owner ticks the box, which sets `names=1` in the address and puts no names in it. Names only: no contact details. The packet downloads as a text file with `Cache-Control: private, no-store`.

## Alternatives considered

- **One request with everything, marked "renewal".** This is simpler, but it is the mistake the rule punishes. The extra time would make the whole request new.
- **Store a renewal draft per season.** That needs a migration and goes stale as soon as the permits change. The draft is cheap to recompute.
- **Rosters with names by default.** Parks' review may ask for rosters, but counts usually answer the question. Names stay off until an owner chooses.
- **A PDF packet.** Text pastes into Parks' forms and emails as is, with no PDF library or service to budget.

## Consequences

- A season whose permits span two Parks periods renews only the first period's dates. The screen says how many were left out.
- A field whose venue has no pin, or isn't near a Parks field in the snapshot, lands in a "borough not known" application.
- Bylaws aren't in the app, so they aren't in the packet.
