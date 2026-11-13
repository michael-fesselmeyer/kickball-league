# ADR 0011: Live scores by polling a cached JSON route

- Status: accepted
- Date: 2026-11-12

## Context

The ref, or a captain when there is no ref, enters the runs after each half-inning from their phone. Spectators and teammates on the public game page should see each half within 15 seconds without reloading (roadmap section 4, milestone 2). At most six games run at once, each followed by a few dozen phones, mostly on park cell signal. The rest of the game page must stay as fast as it is, inside the JavaScript budget in [design-system.md](../design-system.md#performance-budgets).

## Decision

**Store halves, not running totals.** One `game_period` row per half-inning holds its runs. The line score, the score so far and the score at the last complete inning are worked out from those rows (`src/domain/scores/live.ts`). A correction updates one row and everything that depends on it follows. Who kicks in the top of each inning is decided at the field, so it is recorded once on the game (`game.kicks_first`) instead of on every row.

**The final score still goes through the report flow.** Ending the game from the scorer files an ordinary score report: every run for a game played out, or the score at the last complete inning for a called game (rulebook 3.1.5). The other captain confirms it as usual, so live scoring adds no second path to a final result.

**Poll a small cached JSON route.** `GET /api/games/[game]/live` returns the halves and the score's state in one query, well under a kilobyte. The server keeps the answer for 5 seconds in a `use cache` entry tagged `game:{id}`, and every action that changes the game expires the tag. The response allows a CDN to keep it for another 5 seconds. A small client island on the game page asks every 10 seconds while the tab is visible, so a new half reaches a spectator within about 15 seconds. It asks only while the game is on (from half an hour before its slot starts until three hours after it ends, or within two hours of the last half entered), and stops once the game is final. Everything else on the page is unchanged; the line score itself is a server-rendered table when the game is over.

## Alternatives considered

- **WebSockets.** Instant updates, but each spectator holds a connection open for the whole game, which keeps a function running and gets no help from the CDN. Phones drop connections at the park and need reconnect logic and a fallback anyway. Nothing about a kickball game needs sub-second updates.
- **Server-sent events.** Simpler than WebSockets and fine on the hosting platform, but still one open function per spectator for the length of a game, and no help from the CDN. It stays the upgrade path if 15 seconds ever feels slow.
- **Re-render the whole page on a timer.** No new route, but each refresh sends the full page and repaints it, which costs more data on a phone and loses scroll position.
- **Store a running score per team.** Fewer rows, but a correction to an earlier inning would have to rewrite every later total, and a called game could not go back to the last complete inning.

## Consequences

- A spectator sees a new half 10 to 15 seconds after it is saved. The scorer sees it at once, because their page reloads after each save.
- With six games and a hundred phones, the database answers about one live query per game every 5 seconds per server, whatever the crowd size.
- The game page carries a little more client JavaScript (the poller and the table, a few kilobytes) only while the game can still change.
- A page left open on a game nobody is scoring stops asking three hours after the slot ends.
