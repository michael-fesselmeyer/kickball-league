# ADR 0053: The ref assigner proposes, admins accept, and pay follows games worked

- Status: accepted
- Date: 2026-11-14

## Context

Admins staffed games one at a time, typing a ref's email on the season's Referees page. Nothing recorded when refs could work, so admins asked around each week, and nothing added up what each ref was owed, so pay was worked out by hand from memory and a notes app. Section 2.6 of the data model sketched a fuller referee system (applications, Stripe payouts, per-game bonuses) that was never approved; the owners approved a smaller one: a pool of refs, when each can work, an assigner, and a pay sheet paid in cash or Venmo.

Two rules matter more than the rest. A ref never refs a game their own team plays (issue #296): a ref's score report lets either captain make the score final. And the league has to be able to trust the pay sheet, so it can't count a game nobody worked.

## Decision

**The pool.** `referee_profile` holds who admins can assign, per league. Being in it makes someone a ref (`Subject.isReferee`) before their first game, so they can open their own page.

**Availability is a set of start times.** A ref ticks the season's game times they can work; one `referee_availability` row per time, whatever the field. No row means they can't. A time they already ref a game at is shown fixed on their form and can't be taken back there; they ask an admin to take them off instead.

**The assigner is pure, proposes, and never assigns.** `proposeReferees` (src/domain/referees/assign.ts) takes the games without a ref, the pool with each ref's times and teams, and what each ref is already doing (games they ref, which count toward their share, and games their team plays, which don't). It:

1. fills games in time order, giving each to the ref with the fewest games this season who can take it, and of those, one who stays on the field they're already on;
2. then moves a game from a ref to another with at least two fewer whenever it fits, a local search that ends because each move lowers the sum of squared shares;
3. repeats both until nothing changes.

Its promises are property tests: only at a time the ref ticked; never their own team's game; never two places at once (refereeing or playing); never back-to-back games on different fields (less than 30 minutes apart); fair, in that no proposed game could go to a ref with two or more fewer games; and complete, in that a game left without a ref has nobody who could take it, with the reason shown.

Admins see the proposal for a game day or the whole season and accept all of it, accept one game, or pick another ref by hand. Accepting checks every pair again against the season as it is then. The hard rules (own team, two places at once, in the pool, game still unstaffed) always hold; availability and the field preference are the admin's to overrule when picking by hand. Accepted proposals are ordinary `referee_assignment` rows, so the game pages, the ref's home and the game-day command center need no change. The one-live-assignment index makes two admins accepting the same game at once safe: the second insert is skipped.

**Pay follows games worked, at one fee per season.** `referee_pay_rate` holds the season's per-game fee. A game counts as worked when the ref's assignment is accepted or completed and they checked in for it or reported its score as its ref. So a forfeit or a rain-out called at the field counts if they turned up, and a game called off before they arrived doesn't. Owed is games worked times the fee; nothing owed is stored, so changing the fee recomputes everyone.

**A payout is an expense.** Marking a ref paid (cash or Venmo) writes a `referee_payout` and a `refs` expense in the season's books in the same transaction. The expense note names the method, not the ref, because the books' tax export names nobody. The form carries what the sheet showed as already paid; under a lock per ref and season, a payment whose sheet is out of date (a double tap, or two admins) is refused. Owners and admins see the sheet; a ref sees only their own games and pay.

## Alternatives considered

- **Assign automatically on a schedule.** Faster, but admins know things the app doesn't (who is reliable, who is new), and a wrong automatic assignment emails a ref. Proposing keeps the admin in charge at the cost of one tap.
- **An exact solver (integer programming or max-flow with fairness).** It finds the most balanced plan, but a league week is a few dozen games and a handful of refs, where greedy fill plus local search reaches the same balance in microseconds, runs in the browser's request with no dependency, and is easy to test as properties.
- **Store the fee on `season`.** One column fewer, but the season table is shared by several features in flight, and a separate row keeps who changed the fee and when.
- **Pay per assignment (`referee_assignment.fee_cents`).** Allows a different fee per game, which nobody asked for, and makes a fee change a bulk update instead of one row.
- **Stripe payouts.** They need a paid platform account and identity checks for every ref, which ADR 0021 rules out.

## Consequences

- A ref has a page (`/app/referee`) to say when they can work and see what they've earned; admins have "Assign refs" and "Pay sheet" beside the season's Referees page.
- The by-email assignment on the Referees page now also refuses a player on either team.
- Deleting an account takes the person out of the pool and clears their times; their past games and payouts stay, pointing at the anonymized account.
- A postponed game the ref checked in for and then refs again counts once.
