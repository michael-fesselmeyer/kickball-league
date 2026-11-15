# ADR 0071: Playoff formats and tiers

- Status: accepted
- Date: 2026-11-15

## Context

Playoffs only seeded one single-elimination bracket. Leagues also run double elimination for the top seeds, a second bracket for the next group of teams so everyone keeps playing, and a third-place game. Built by hand, these lead to mistakes about who plays next and when.

## Decision

- A bracket is a graph of matches whose sides come from a seed, or the winner or the loser of an earlier match. Single elimination, double elimination and the third-place game are all built from it in `src/domain/scheduler/bracket.ts`, and the same `advance` moves winners and losers on.
- Double elimination drops each winners' round's losers onto a losers' side (reversed every other round to put off rematches). The two side champions meet in a grand final. Its "if necessary" second game is placed with a reserved slot from the start and is skipped, its slot handed back, when the winners' side champion wins the grand final. A corrected grand final brings it back or cancels its game while it is still to be played.
- Placement runs in waves: each game waits for every game it depends on and for the round before it on its side, and every wave starts after the last one ends. A team's next game always depends on its last, so no team is ever placed twice at once.
- Games are numbered in the order they are placed, and undecided sides read "Winner of game 3" or "Loser of game 5", on the board and in the list.
- Tiers split the season-wide standings into up to three consecutive brackets, each with its own format, playoff day and innings. A season with divisions keeps one bracket per division (ADR 0040) and cannot add tiers. Only the first tier's champion is the season's champion in history and on season cards.
- Innings are stored per bracket for early games and title games (the final, or both grand finals) and shown on each game; empty means the league's usual length.
- When a rain-out pushes an earlier game past a later game's reserved slot, the later game takes the next free open slot after it instead.

## Consequences

- Double elimination plays up to 2n − 1 games for n teams, so it needs about twice the permit time; the admin sees a note for any game with no slot left.
- A third-place game needs two semifinals, so it is left out, with a note, for three teams.
- Brackets made before this change have no game numbers stored; they are numbered round by round when shown.
- Tiers and divisions do not combine. A league that wants both would need a tier per division, which is left for later.
