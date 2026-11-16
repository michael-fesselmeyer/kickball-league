# ADR 0069: Offer alerts when they help, and turn down instead of off

- Status: accepted
- Date: 2026-11-15

## Context

Players get alerts by free web push and email; the league sends no text messages ([ADR 0021](0021-free-services-only.md)). League news became opt-in for new accounts (#331), which also silenced shirt size reminders, rule change notices and surveys for them (#521). The league wants more players to choose alerts, without the app ever feeling spammy enough that people mute it or uninstall it.

Asking for notification permission on a first visit is the common way to get push turned on, and the common way to get it refused for good: a browser that was told "Block" won't ask again. An unsubscribe link offers one answer, off, to someone who may only want fewer emails.

## Decision

**Lean defaults.** Messages about the person's own registration, payments and games are not news: the shirt size reminder joins payment reminders in the `payment` topic, and rule changes get a `rules` topic ("Rules and schedule"), on by default. Survey invitations, event news and announcements stay news, opt-in for new accounts. Choices people already saved are kept as they are; nothing is migrated.

**Ask at the moment it helps, once.** The home and team pages show at most one in-app card, when its moment has come: a first RSVP (rain-out push), joining a team (sub-request push), a first finished game (a weekly roundup of league news), the end of the last season played (next season's news and the survey). Each card shows a sample message. The answer is stored (`alert_card_response`) so a card never asks twice; after any answer the next card waits a week, and after "No thanks" none shows for 30 days. A card whose alert is already on is skipped. Only "Yes" on a push card opens the browser's permission prompt; if the browser can't do push, the same topic is turned on by email instead.

**Turn down instead of off.** Next to every email's unsubscribe link, and on the profile page: "Only my team" skips league-wide news; "Weekly digest instead" holds league news for Sunday's digest (or, from a non-news email, makes everything that can wait weekly); "Snooze for 2 weeks" holds everything that can wait for the first digest after it. They live on `alert_setting` and act in the outbox's `decide`, so the daily cap, quiet hours and digests keep working as before, and urgent messages are never turned down. The footer links open the unsubscribe page with the choice ready; only its button changes anything, since mail scanners follow links.

**Measure gently.** Admins see counts per topic: members getting it, "No thanks" on its card, and unsubscribes from email links (`notification_preference.changed_via`). Nothing is shown or kept per person beyond the person's own choices.

## Consequences

- Fewer players see a permission prompt, and those who do have just said yes to a specific alert, so fewer block the site.
- A card's answer is final: a player who said "No thanks" turns the alert on in their settings later. That is the price of never nagging.
- Survey invitations reach only players who opted into news; the season-end card is how most will opt in.
- "Only my team" decides by the message: an announcement with no team, event news and invitations back are league-wide. Messages held before the choice still come in the digest.
- The `rules` topic and the turn-downs need a migration; existing rows are untouched.
