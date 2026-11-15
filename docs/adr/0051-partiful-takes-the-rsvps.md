# ADR 0051: Partiful takes the RSVPs

- Status: accepted
- Date: 2026-11-14

## Context

Most players RSVP to parties on Partiful. An event could already carry an invite link (Partiful or any https page) and take RSVPs in the app as well, and both were on unless the admin unticked a box. With two guest lists, players didn't know which one counted, and the league's headcount was split between them.

Partiful has no public API, so the app can't read its guest list or write to it.

## Decision

**An invite link's guest list is the one that counts.** When an admin types an invite link into the event form, "Players RSVP in the app too" unticks itself, and it ticks again if the link is cleared, until the admin sets the box themselves (`inAppRsvpByDefault` in `src/domain/events/audience.ts`). With the box off, the event takes no RSVPs in the app, so it has no waitlist and sends no RSVP emails, and its page shows one "RSVP on Partiful" button. The admin can still tick the box to take RSVPs in both places.

Two kinds of event keep RSVPs in the app:

- A ticketed event, because tickets are sold in the app.
- An event that already has RSVPs in the app, because switching them off would drop people who already said yes.

Everything else stays in the app, because the invite doesn't do it: the league calendar and `.ics` feeds, the public event page and sitemap, theme weeks, giveaways, volunteer shifts, and telling an event's audience about it.

Buttons, cards, shared messages and emails call a Partiful link "Partiful", and any other link by its host (`inviteSite`).

**The app never fetches the link.** We considered filling the event's title, time and place from the invite's link-preview (Open Graph) tags. Partiful's terms forbid "data mining, robots, scraping, or similar data gathering or extraction methods" and make no exception for link previews. We left it out: the admin types the details, as before.

## Alternatives considered

- **Keep both RSVP paths on by default.** This is the confusion we set out to remove.
- **Always turn RSVPs in the app off when there's a link.** Ticketed events need them, and some admins want a headcount in the app for a capacity-limited room.
- **Store the admin's choice as a separate "RSVP source" field.** It would mean a schema change for the same behavior; the existing `in_app_rsvp` flag already says it.

## Consequences

- No schema change. Existing events keep the setting they were saved with.
- The default works in the browser; without JavaScript the box keeps whatever it last saved, which is the old behavior.
- If Partiful ever offers an API or explicit permission for previews, prefilling can be revisited in a new ADR.
