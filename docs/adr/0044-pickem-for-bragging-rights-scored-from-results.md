# ADR 0044: Pick'em for bragging rights only, scored from confirmed results

- Status: accepted
- Date: 2026-11-14

## Context

Players like to call each week's games before they happen. A pick'em gives them a reason to open the app between game days and something to argue about at the bar afterwards. It touches three things that need a decision: what keeps it clear of gambling, when a pick closes, and how a pick is scored when a game doesn't end the ordinary way (a forfeit, a tie, a rain-out or a reschedule).

## Decision

**Bragging rights only. No money, ever.** Pick'em has no entry fee, no buy-in, no pot, no prizes of value and no paid tier, and the app never takes or pays out anything for it. Without consideration (paying to play) or a prize, a prediction game is not gambling, and the league keeps it that way: any change that adds a fee, a prize, a wager between players or a link to a betting site is out of scope for this feature, whatever it costs to build. The pick'em page and its admin settings say so in plain words. This also keeps the feature inside the free-services rule ([ADR 0021](0021-free-services-only.md)): it needs nothing but the database.

**Any signed-in player picks the coming game day.** The page shows the games of the coming game day: the league-time date of the earliest game still open for picks, so the day stays up after its first game starts while later games are still open. A player picks a winner for each game and can change a pick as often as they like.

**Each game locks at its own start.** A pick is accepted only while its game is `scheduled`, in a slot that hasn't been called off, and `now` is before the slot's start. The server checks every pick when it is saved, so a page left open past first pitch can't sneak one in; the rest of the form still saves and the page says which picks weren't taken. Start times are instants, so the lock does not depend on the time zone; the league's time zone decides which date a game day is and how the lock time reads.

**A pick belongs to the slot it was made for.** `pickem_pick.slot_id` stores the game's slot when the pick was saved. If the game later moves (a rain-out moves it to a makeup slot) or its slot is deleted, the pick is void: a pick for Monday's game is not a pick for the makeup two weeks later, when rosters, weather and form are different. The player can pick the makeup game again when it comes around, which replaces the void pick.

**Scores come from confirmed results, and are never stored.** A pick is scored only once the game is `final` (both captains confirmed, the ref's report stood, or an admin settled it); live scores never count. A final game with a winner makes each pick right or wrong. A forfeit, a tie, a cancellation, a postponement, a called-off slot, or a pick for a slot the game has left makes the pick void: it counts for nobody, neither right nor wrong. The rules are pure functions (`src/domain/pickem/pickem.ts`); the leaderboard query asks them which games scored and then counts each player's right picks among those games in one grouped query. Nothing is copied into a score table, so an admin's score correction moves the leaderboards straight away, the same choice as discipline counts ([ADR 0026](0026-discipline-counted-not-stored.md)).

**Two leaderboards, ties share a place.** A game day board and a season board rank players by right picks. Players with the same number share a place and the next place is skipped (1, 2, 2, 4). Within a place the list orders by fewer scored picks, then by name, but the place itself is shared. A player can hide themselves from both boards (`pickem_hidden`), and still sees their own record.

**Own-team games are the league's call.** Some leagues like players backing their own team; others think it makes the board about loyalty, not judgment. `league.pickem_own_games` (allowed by default) lets an admin keep players off their own team's games. Picks already made stay. Changing it writes a `pickem.own_games` audit row.

**The operator can switch it off** like the other optional features (`pickem` in the operator's feature list).

## Alternatives considered

- **Prizes from sponsors, or a paid entry with a prize pool.** More excitement, but a paid entry with a prize is a wager in most places, and even a free entry with a valuable prize brings sweepstakes rules. Bragging rights carry none of that.
- **Lock the whole day at the first game.** Simpler to explain, but it shuts the 9 pm game's picks at 7 pm for no reason.
- **Keep a pick when its game moves.** Fewer lost picks, but the player picked the game they expected to see that night; a makeup weeks later is a different call, and it would let a player sit on a pick until they had seen how both teams were doing.
- **Count a forfeit for the team that didn't forfeit.** That rewards whoever guessed which team would show up, not who would win the game. Ties are void for the same reason: there is no winner to pick.
- **Store each pick's result when the game settles.** Faster reads, but every correction, forfeit and rain-out would need a job to rescore, and a missed run leaves the board wrong. A season has at most a few thousand picks, which one indexed query counts quickly.

## Consequences

- One grouped query per leaderboard, over the season's picks for scored games (`pickem_pick_once` and the game list keep it narrow).
- A rain-out voids picks for that slot even if the game is replayed, and the player picks the makeup game again.
- Deleting an account deletes its picks and its hidden choice; merging accounts keeps the kept account's pick when both picked a game.
- If the league ever wants prizes, that is a new decision with legal review, not a setting.
