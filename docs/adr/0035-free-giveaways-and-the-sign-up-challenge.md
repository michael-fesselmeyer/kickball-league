# ADR 0035: Free giveaways at events, and a sign-up challenge read from the rosters

- Status: accepted
- Date: 2026-11-13

## Context

Most of what the app does for a player (RSVPs, sub spots, scores, waivers, offline scoring) needs an account, and the league wants every player on every roster to make one. Two incentives fit a social league: a prize drawn at a league event, and a prize for the team that gets its whole roster signed up first.

A prize drawn among entrants is a raffle if people pay to enter. In New York a raffle is gambling that only licensed nonprofit organizations may run; a sweepstakes or giveaway that is free to enter, with published rules, is not. So the design has to make sure entering never costs anything, directly (a ticket, an entry fee) or indirectly (only people who paid for something can enter). The league sells event tickets ([ADR 0027](0027-event-tickets-hold-their-spot.md)) and charges registration fees, so this has to hold by construction, not by an admin remembering it.

The draw also has to be fair and be seen to be fair: the people who run the league are often players and friends of players.

The site must cost nothing to run ([ADR 0021](0021-free-services-only.md)).

## Decision

**Entry is free and needs only an account.** A player enters by scanning the giveaway's rotating code at the event: the sponsors' check-in code ([ADR 0016](0016-rotating-check-in-code.md)) under the giveaway's own secret, so a photo of it stops working within minutes and the entrant was at the event. One entry per person is a unique constraint, and an entry first takes a share lock on the giveaway, so the draw (which takes an update lock) never runs while an entry is landing.

- No giveaway table has a column that can point at a purchase, payment, ticket or registration, and a database test checks it.
- An event that sells tickets can't hold a giveaway: entering means being there, and being there would cost money. If an admin adds a ticket price to an event that already has a giveaway, entry is refused from then on and the admin screen says why. A theme week can't hold one either: it has no one place to check in.
- The event's audience (`src/domain/events/audience.ts`) decides who may enter: anyone with an account for a public event, otherwise the members or teams it is for. Admins see every event but enter only one that is for them. Entry is not limited to people who paid for a season: an account is enough.
- The official rules are required, shown on the giveaway page, and must say no purchase is necessary; the page also shows that line on its own. The default rules say how to enter, who can, how winners are picked and that the prize has no cash value, and the admin edits them.

**The draw is random, seedless and audited.** After entry closes, an admin draws in the app. The entries, ordered by when people entered, go through a partial Fisher-Yates shuffle where each pick is `crypto.randomInt` (the operating system's secure random source). No seed is kept, so nobody can rerun or steer the draw. The audit log records the entry count, how many winners were asked for, the method, the drawn positions and the winners' entry and account ids (no names). Unit tests check, exhaustively for small draws, that every sequence of random answers gives a different ordered result, so each outcome is equally likely with a uniform source, and a statistical test checks that each entry wins about as often as the others with the real source.

**A redraw replaces one winner and needs a reason.** A winner who doesn't claim the prize, or turns out not to be eligible, is marked replaced with the admin's reason (5 to 300 characters), and one new winner is drawn the same way from the entries that never won. An entry wins at most once (a unique constraint), so a replaced winner can't be drawn again. The redraw is audited with the reason.

**Winners hear once.** Each new winner gets one `giveaway_win` message, classified non-urgent ([ADR 0019](0019-urgent-and-non-urgent-messages.md)), and sees the win on the app's home screen and the giveaway page. The giveaway page never names a winner; admins see names to hand over the prize.

**The sign-up challenge is read from the rosters, never stored.** An admin starts one challenge per season with a prize and a deadline. A team's progress is the roster board's joined and signed marks: players on the active roster with the season's waiver signed (everyone on a roster already has an account), out of the team's target roster size, or the season's minimum when it has none, or the roster when that is bigger. So a team of two can't win by staying small. One query reads every team's roster spots with when each player joined and signed; the domain ranks them.

- A team is complete when everyone it counts has signed up, at the moment its last player finished (joined and signed). Teams complete by the deadline rank first, earliest first, which is "first to 100% wins, ties broken by the time the last player joined". The rest rank by percent.
- An admin confirms the winner: the team at the top that completed by the deadline. If two teams finished at the same instant, the admin picks between them. Confirming stores the winner and writes the standings (team ids and counts) to the audit log; after that the challenge can't change.
- The leaderboard shows team names, counts and percentages to signed-in players: no player's name, and nothing about who hasn't signed. The admin dashboard shows the same counts, lowest first, with how many players each team still needs.

## Alternatives considered

- **Entry with a ticket or a registration.** The easy way to tie entry to presence, and exactly what makes it a raffle. Rejected outright.
- **A free alternative way to enter (mail-in or online form) alongside a paid one.** How sweepstakes with a purchase stay legal, but it adds a second entry path to police and invites the paid path. Every path here is free.
- **A seeded, reproducible draw (publish a seed or a hash commitment first).** Lets anyone recompute the result, but adds a ceremony nobody in a social league will check, and a seed known in advance can be gamed. The audit row plus the tested method is the record.
- **`Math.random` or a shuffle library.** `Math.random` is not a secure source and can be predicted; a library adds a dependency for twenty lines.
- **Redraw everyone when one winner is replaced.** Takes a prize from winners who did nothing wrong.
- **Storing each team's progress, updated on every roster change.** Faster to read but easy to get out of step; one query per season is cheap at league size, and the challenge stores only the confirmed winner.
- **Counting paid players instead of signed waivers.** Would make the challenge about money; the goal is accounts and waivers.

## Consequences

- An admin can't run a giveaway at a ticketed event. A paid party that wants a prize draw has to make the draw part of a free event.
- A player has to be at the event and signed in to enter. Someone without an account makes one on the spot; the code stays valid for 5 to 10 minutes, and an expired code says to scan again.
- Deleting an account removes its entries in giveaways not drawn yet. A drawn giveaway keeps its entries under the anonymized user, so the audit record still adds up.
- A team whose captain set a large target roster size has to fill it to win. Admins can see this on the dashboard and nudge.
- Progress is live: a team that reached 100% and then added a player who hasn't signed drops below it until they do. The confirmed winner doesn't change after confirmation.
- No paid service is involved: the code, the draw and the messages use what the app already runs on.
