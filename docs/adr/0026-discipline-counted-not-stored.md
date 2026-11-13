# ADR 0026: Count games served instead of storing them, and keep ratings anonymous by aggregation

- Status: accepted
- Date: 2026-11-13

## Context

Sportsmanship ratings, incident reports and suspensions (product spec, section 6, Game day) raise two design questions.

A suspension "for 2 games" has to count down as the player's team plays. Games become final along many paths: a ref's score confirmed by a captain, a score settled after 24 hours without a dispute, a live-scored game ended, an admin's correction, a forfeit. A stored counter would need every one of those paths, now and in the future, to remember to decrement it, and a corrected or reopened score would have to put a game back.

Ratings must never show who rated what. A team plays one game against each opponent, and each game has exactly two ratings, one from each captain, so any per-game view, or an average over one game, gives the rating away.

## Decision

**Games served are counted when they are read.** A suspension stores its scope (games, season or permanent), the number of games, when it began and whether an admin lifted it. Games served are the suspended player's team games, on any team they are active on, that kicked off after the suspension began and are now final or forfeited: one grouped query for any number of suspensions (`suspensionsWhere` in `src/db/queries/discipline.ts`). A game that kicked off before the suspension, or that was cancelled or postponed, never counts. A season suspension ends when its season is completed or its last day has passed; a permanent one lasts until lifted. The pure rules are in `src/domain/discipline/discipline.ts`.

**One check guards every way into a game.** `suspendedAmong` answers "who of these people is suspended now", and RSVPs ("in" only), sub claims (and who hears about a sub request) and free-agent placement all ask it. Already-issued suspensions are enforced even when the operator switches the feature off; only the screens go away.

**Ratings are only ever shown as aggregates.** Admins see each team's average for the season with the notes sorted alphabetically, never which game or team a rating came from. A captain sees their own team's average over whole blocks of three ratings: it appears after the third rated game and moves only when the next block of three fills, so neither the average nor how it changed gives one rating away. The audit row for a rating records that one was given, not the score. The rater's id is stored only so the person's own export can list it and deleting their account can remove the note.

**The ladder is a suggestion.** For outside alcohol, rulebook 4.0's 1 game, then a season ban, then a permanent ban is preselected from the player's earlier outside-alcohol suspensions (lifted ones do not count). The admin can always choose another length.

## Alternatives considered

- **A `games_served` column updated when a game becomes final.** Fast to read, but correct only while every finalizing path remembers it, and wrong after a score is corrected.
- **A list of the specific games a suspension covers.** Clear for captains, but a rain-out or a rescheduled game changes which games those are; counting the team's final games adapts on its own.
- **Show each team the ratings it received per game.** More useful feedback, but it names the rater every time.

## Consequences

- Reading a suspension costs one extra grouped query; the pages that read them (the team page, the review queue, sub requests) already make a few queries, and the counts use existing game and roster indexes.
- If a final score is reopened, the countdown moves back on its own.
- A player who moves teams mid-suspension serves it with the new team's games; one not on any team does not serve games until they are.
- A captain cannot see their own average until the third rated game, and it lags by up to two games after that.
