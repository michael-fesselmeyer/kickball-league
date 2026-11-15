# ADR 0054: A game with no ref asks the free refs, and the first to take it gets it

- Status: accepted
- Date: 2026-11-14

## Context

Refs come from among the players. On some game days a game has no ref, or its ref drops out at the last minute, and admins find out at the field. Issue #389 asks that a ref can drop a game with a reason, that a game starting within a day with no ref reaches the league's refs at once, and that exactly one of them gets it.

The site runs on free services ([ADR 0021](0021-free-services-only.md)): scheduled jobs run once a day on the free hosting plan, there is no realtime service, and email is capped at 100 a day.

## Decision

**A ref drops a game themselves, until it starts.** "Can't make it?" on the ref's page takes a short reason (up to 200 characters) and sets their assignment to `declined`. The reason goes in the audit log, which admins read; nothing new is stored. After the start, only an admin can change the ref.

**Who is asked.** The league's refs: everyone in the ref pool ([ADR 0053](0053-ref-assigner-and-pay-sheet.md)) and anyone who has reffed a game that season. Of those, nobody whose team plays in the game, nobody playing or reffing another game at that time, and not the ref who just dropped it (`whoToAsk`, property tested). Availability is not a filter here: at a day's notice a ref who didn't tick the time may still be free, and the message lets them say so with one tap. Back-to-back games on another field don't rule anyone out either. A draft season's games aren't out yet, so nobody is asked about them and the game-day screen doesn't list them.

**When.** At once when a ref drops a game that starts within a day; and from a daily job, late morning, for every game starting within a day that has no ref (one never assigned, or one an admin took the ref off). Each ask is one urgent message per ref, email and push under the existing "Sub requests" setting, deduplicated per game, round and person: asking again about the same gap sends nothing, while a game that gains a ref and loses it again asks again.

**First to take it wins.** The message's "Take it" button opens a page with one button. Taking locks the game row inside a transaction, re-checks that the game is still to come and unstaffed and that the ref may take it, and inserts the accepted assignment; the one-live-assignment index backs this up. A second ref finds "Someone beat you to it". The game-day command center lists every game starting within a day with no ref.

## Alternatives considered

- **Offer the game to one ref at a time.** Fairer to the pool, but each offer needs a timeout and a job to move on, and the free plan's daily jobs can't run one every few minutes. At a day's notice, speed matters more.
- **A new message topic for refs.** Clearer on the settings page, but the topic is a database enum, so it needs a migration and a turn in the schema queue for one line of settings. Refs asked to cover a game is close to players asked to sub, so the "Sub requests" setting covers both, and its hint says so.
- **Store the drop reason on the assignment.** A column for one sentence that only admins read; the audit row already has who, when and the reason.
- **Ask from the game-day screen's polling.** Admins' screens poll every 10 seconds, but asking from a read would send messages because someone looked, and not when nobody did.

## Consequences

- A ref who can't make it says so in two taps, and the free refs hear within a minute when the game is soon.
- A game that loses its ref more than a day ahead isn't asked about until the daily job finds it within a day; the assigner still shows it to admins.
- An admin taking a ref off a game soon doesn't ask anyone at once; the daily job or the command center catches it.
