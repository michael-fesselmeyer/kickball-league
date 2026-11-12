# ADR 0006: Sub claims hold a spot, and requests close by time

- Status: accepted
- Date: 2026-11-12

## Context

A short-handed captain asks for subs for one game. Several players may answer within seconds of the email going out, the captain may be at work, and the fielding rule (at most six of one gender on defense) means a request often needs women or men in particular. The flow in [information-architecture.md](../information-architecture.md), section 2.6, had to pick how claims turn into a lineup, and how a request ends.

## Decision

**A claim holds a spot until the captain answers.** "I'm in" creates a `sub_claim` in `pending`, and a request takes only as many pending or approved claims as it has spots. The captain approves (the player is playing) or declines (the spot opens again). When every spot is approved the request is `filled`; an approved sub who drops out reopens it.

**Reserved spots for the fielding rule.** A request has `needed`, plus `women_needed` and `men_needed` spots that only a player in that fielding group can take. The rest are open to anyone, including players who have not set a fielding group. `hasSpotFor` in `src/domain/subs/eligibility.ts` admits a claim only if the spots still reserved for others fit in what is left, so whoever claims first, the request can always be finished by the right players. Property tests check both that and that a request never fills past what was asked.

**One lock per request.** Claiming, answering, dropping out and taking a request down each run in one transaction that first locks the `sub_request` row (`select … for update`). Two players claiming the last spot at once are served one after the other, and the second is told it is full. A database test commits on two connections to prove it, and it fails if the lock is removed.

**Requests close by time, not by a job.** `closes_at` is the game's start. Every query compares it with now, so a request past game time is closed whatever its status says. The planned 15-minute expiry job (architecture.md, section 4) is not needed, which also suits the hosting plan's once-a-day crons.

## Alternatives considered

- **Claims as a pool the captain picks from.** Simpler to write, and the captain chooses, but players would not know whether to keep their evening free, and a fast "first approved fills it" rule still needs the same lock. Holding a spot gives each player an answer: holding, playing or not needed.
- **A single gender field on the request.** It cannot say "two subs, at least one woman", which is the usual case under the fielding rule; two separate requests for one game would notify the same people twice.
- **A unique index or a counter column instead of a row lock.** A counter can enforce the total but not the reserved spots, and a check across rows is not something Postgres constraints express. The row lock keeps the rule in one tested function.

## Consequences

- A captain who never answers keeps spots held until game time. The captain gets an email for every claim, and the team page links to the request.
- A claim records the player's fielding group when they claim, so later profile edits do not change which reserved spot it filled.
- Suspensions are not modelled yet (P3), so "not suspended" from the product spec is not checked. When the suspension table arrives, `checkEligibility` gains one more reason.
