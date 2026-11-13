# ADR 0035: Divisions play their own round robin, plus crossover rounds that count by default

- Status: accepted
- Date: 2026-11-13

## Context

Some seasons split teams by level, for example Competitive and Social, while others play as one pool ([product-spec.md](../product-spec.md), section 2: divisions and rule sets are optional so either reality works). A divided season still wants a few games between the divisions, so teams meet new opponents and the two halves of the league mix. That raises four questions: how crossover games are scheduled without weakening any of the scheduler's guarantees, whether they count in the standings, how the playoffs are seeded, and how the public pages show a division without becoming dynamic.

## Decision

**Divisions are optional and owned by the season.** A `division` belongs to one season, with an optional `rule_set` from the league (innings, a time limit, bunting and stealing). A team joins one through `team_season.division_id`, which with `season_id` references `division (id, season_id)`, so the database refuses a division from another season. A season with no divisions plays exactly as before: the scheduler sees one pool, the standings one table, the playoffs one bracket.

**Crossover games are whole rounds, and need exactly two divisions.** The admin sets `season.crossover_games`, the number each team plays against the other division. Stage A of the scheduler adds that many crossover rounds, in which every game is between the divisions ([scheduling-algorithm.md](../scheduling-algorithm.md), "Stage A, continued"):

- Every team of the smaller division plays in every crossover round, so it plays exactly the set number. The larger division's teams take turns in a fixed order, so their counts differ by at most 1 and equal the set number when the divisions are the same size. The rest of the larger division sits the round out, as a bye does.
- Opponents within a round are matched to keep repeat meetings to a minimum, so nobody meets a crossover opponent twice while a new one is free.
- Crossover rounds are spread evenly between the division rounds. Each division still plays its rounds in order, so round-robin order (H5) holds within each division.
- A new hard rule, H11, is checked independently in `validate`: crossover rounds hold only crossover games, each team at most once, and each team plays its crossover count. Property tests P15 to P17 cover counts, division balance and every existing constraint.

Because a crossover round is a round, everything after Stage A (dates, placement, local search, rain-outs, manual edits) works unchanged, and every fairness guarantee applies to crossovers as to any game.

**Crossover results count in the division standings by default.** A team's record is every regular-season game it played, so a crossover win is a win; leaving crossovers out would make a team's public record disagree with its game list. Some leagues rank divisions on division games only, so `season.crossovers_count` turns this off, and the standings page says which rule applies. Either way a team is ranked only against its own division, and head-to-head looks only at games inside the division.

**Playoffs seed per division.** The admin picks how many teams each division sends. With two divisions and `season.combined_final` (the default), they share one bracket: each division fills one half in its own standard order, so the two division champions meet in the final and nobody meets the other division earlier. Without a combined final, or with more than two divisions, each division gets its own bracket (`bracket.division_id`) and its own champion; the brackets are placed one after another on the free slots in one draft schedule version and published together. League history names a season champion only from a season-wide bracket.

**A game has no division of its own.** A crossover belongs to two divisions, so `game.division_id` from the original data model was left out. The teams' divisions say which division's schedule shows a game and whether it is a crossover.

**A division's schedule is a path.** `/seasons/<season>/schedule/division/<division>` shows a division's games and crossovers. It is a static route, prerendered for every public season's divisions and expired with the season's tag, never a query string (AGENTS.md, "Keep it fast"). It cannot clash with the team filter, whose rewritten path has one segment.

## Alternatives considered

- **Crossover games inside the division rounds.** Pairing some teams across divisions in an ordinary round would break each division's round-robin order and make byes uneven. Whole crossover rounds keep both properties for free.
- **Exact counts for every team, whatever the division sizes.** With two divisions of different sizes, every team cannot play the same number of crossovers: the two sides' games must add up. Exact counts for the smaller division and an even share for the larger is the closest possible.
- **Crossovers between any number of divisions.** Matching three or more divisions so every team plays a set number of cross-division games is possible but needs a different construction and has no current use. The scheduler reports why there are no crossovers instead.
- **Crossover results never count.** Simpler to explain in a division table, but a team's record would leave out games it played. It is the switch, not the default.
- **One bracket per division always.** It loses the final between division champions that leagues with a Competitive and a Social division often want. It is the choice when the combined final is off.
- **A division filter in the query string.** A page that reads the query string is rendered on every request; a path keeps the page static.

## Consequences

- Admins manage divisions, rule sets, crossover counts and the playoff format on one screen. The schedule screen names the divisions and defaults the number of rounds to one round robin of the largest division; crossovers come on top.
- A team with no division in a divided season plays as a pool of its own and gets a table of its own, and the divisions screen asks for every team to be placed before generating. A divided season's playoffs leave such teams out.
- The demo league's Summer 2026 is split into Competitive and Social. Its full round robin is three division games and four crossovers a team, so it counts four crossover games.
- Changing a season's divisions after a schedule is published changes the standings at once, but the games only after the admin generates and publishes again.
