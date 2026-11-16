# ADR 0085: Guest teams and partner tournaments are an event's extra row, not a season

- Status: accepted
- Date: 2026-11-15

## Context

Other kickball leagues in the city run their own seasons, and playing together (one-day tournaments, charity events, friendlies) is good for everyone. A guest team's players have no account here, play once, and should leave nothing behind that the league has no reason to keep. Most of what a tournament needs already exists: events with places and times, the waiver, the single-elimination bracket, the Friends of the league directory.

Private tournaments ([ADR 0049](0049-private-events-are-private-seasons.md)) are private seasons: every team is a real team with a roster, entered by signed-in captains. That fits a company's league. It doesn't fit a guest team, which would need a team, a registration and a roster of accounts just to appear in a bracket.

## Decision

**A tournament is an event with a `tournament` row.** The event keeps its place, time, page, share buttons and calendar feed. The row adds guest sign-up settings, the charity link, the partner league and the bracket. Guest teams are their own small table (`guest_team`), and are not teams, registrations or roster entries.

**The bracket reuses the playoff engine, not its tables.** `placeBracket` lays out the rounds and `advance` moves winners on, so byes, corrections and the rule that a bracket game can't end in a tie behave as in a season's playoffs. The bracket is stored as one jsonb document on the tournament, with the team names copied in, because its teams aren't season entries and because it must outlive the guest data. Fields and times are free text and a time an admin types, in the league's time zone, not slots from the permit scheduler: a one-day tournament on a field the league already holds doesn't need the season scheduler. Only single elimination is offered; the other formats from the playoff work can follow once they are on main.

**Guest data is minimal and goes on a schedule.** A guest captain gives a team name, a name, an email and a head count. Each player gives a typed name; the app stores it with the time and the hash of the newest waiver text. No IP address, browser, phone or account. The public page shows team names only. The outbox's daily sweep ([ADR 0058](0058-scheduled-announcements-ride-the-daily-sweep.md)) deletes the guest teams, which deletes their signatures, `guest_data_days` (1 to 90, default 30) after the event ends, or at once for an event an admin deleted. The bracket stays: it holds team names and scores.

**The waiver link is a secret in a path.** Guest players have no session to prove who they are. A 24-byte random token in `/guest/[token]` gives access to one team's waiver and the count of signatures, and nothing else. The page isn't indexed. The captain sees the link once after signing up, and admins can read it on the event's admin page.

**The sign-up forms are public Server Actions** with a honeypot and the rate limits used by the public contact form, since a captain's email and a network address are the only things to count on. The event page itself stays static HTML.

**Charity mode is a link.** The page shows the charity's name, an https link and a goal the admin typed. The app takes no donations, counts none and shows no "raised so far" figure, since it would have to trust a number it can't check.

## Alternatives considered

- **A private season per tournament, with guest teams as real teams.** Reuses the season scheduler, standings and brackets as they are, but needs an account for every captain and a roster for every team, and leaves their data in the season's records for good.
- **Real `bracket` and `bracket_match` rows.** They point at season team entries, so every guest team would need one.
- **Keep guest signatures with the season's waiver signatures.** Those point at users and are append-only, by design.
- **Emailing the captain the waiver link.** Another message to rate-limit and a second place for the link to leak; the page shows it once and the admin screen shows it again.

## Consequences

- Deleting guest data can't touch anything else: nothing references `guest_team` except its signatures.
- A tournament can't take a guest team after its bracket is drawn, and a team in the bracket can't be removed until the bracket is reset, which needs no game to have been played.
- An admin who needs a double-elimination or tiered bracket for a guest tournament waits for those formats to be added here.
