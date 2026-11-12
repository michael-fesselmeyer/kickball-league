# Scheduling algorithm

Status: draft v1, 2026-11-11. This is the technical showpiece, so it is specified tightly enough to build and test from.

The worked example in section 9 was computed and checked with a throwaway prototype that is not part of the repository. The numbers in it are real output, not illustrations.

## 1. Shape

The scheduler is a set of pure functions in `src/domain/scheduler/`. They take plain data and return plain data. They do not read the database, the clock or the network, and all randomness comes from a seed in the input, so the same input always gives the same schedule.

| Function | Does |
|---|---|
| `generateSlots(permitWindows, blackouts, format)` | Cuts permit windows into game slots of the format's length |
| `generate(input)` | Builds a full season schedule |
| `validate(input, schedule)` | Lists every hard-constraint violation; written separately from `generate` so it can check it |
| `measure(input, schedule)` | Computes the fairness metrics |
| `applyEdit(input, schedule, edit)` | Applies a manual move or swap and returns the new schedule with violations and metrics |
| `reschedule(input, schedule, cancelledSlotIds, policy)` | Places postponed games after a rain-out |
| `placeBracket(seeds, playoffSlots)` | Lays a playoff bracket onto slots |

```ts
type SchedulerInput = {
  teams: { id: string; divisionId?: string }[]
  slots: { id: string; date: string; timeIndex: number; fieldId: string;
           kind: 'regular' | 'makeup_reserve' | 'playoff' }[]
  rounds: number                    // rounds to play; one round = each team plays once (or has a bye)
  gamesPerTeamPerDay: 1 | 2         // 2 = doubleheaders (summer)
  reservePerDay: number             // slots to leave empty each day for makeups
  constraints: { teamId: string; kind: 'unavailable' | 'prefer' | 'avoid';
                 date?: string; timeIndex?: number; weight?: number }[]
  locked: { gameKey: string; slotId: string }[]   // manual pins
  weights: Weights
  seed: number
}

type Schedule = {
  games: { key: string; round: number; teamA: string; teamB: string; slotId: string | null }[]
  byes: { round: number; teamId: string }[]
  unplaced: string[]                // game keys with no slot
  diagnostics: string[]             // why something could not be placed
}
```

A game's `key` is stable: `r{round}:{teamA}:{teamB}` with the two team IDs sorted. It survives regeneration and is how versions are compared.

## 2. Constraints

### Hard constraints

A schedule that breaks any of these is invalid. `generate` never returns one; `validate` reports them for manual edits.

| ID | Constraint |
|---|---|
| H1 | Every placed game is in exactly one slot, and a slot holds at most one game |
| H2 | A team is never in two games at the same time index on the same date |
| H3 | Games are only placed in slots that exist. Permit windows and blackout dates are applied when slots are generated, so the scheduler cannot place a game outside a permit |
| H4 | A team is never placed in a slot it marked `unavailable` |
| H5 | **Round-robin order.** At the end of every round, the number of times any two teams in the same pool have met differs by at most 1 across all pairs. Equivalently: nobody has a rematch until everyone has played everyone once |
| H6 | A team plays at most `gamesPerTeamPerDay` regular games on one date. Makeups may raise this to 2 |
| H7 | With an odd number of teams, each round has exactly one bye, and bye counts differ by at most 1 between teams |
| H8 | On a doubleheader day a team's two games are against different opponents |
| H9 | Locked games stay in their slots |
| H10 | At least `reservePerDay` slots stay empty on each date, when the date has that many spare |

### Soft constraints

These are scored, weighted and summed into one cost that the optimizer drives down. Lower is better.

| ID | What it measures | Default weight |
|---|---|---|
| S1 | **Time-slot balance.** For each team, how unevenly its games fall across time indexes. Penalty grows with the square of (most-used count minus least-used count, minus 1) | 100 |
| S2 | **Field balance.** The same, across fields | 100 |
| S3 | **Streaks.** Each week beyond 2 in a row that a team plays at the same time index | 20 |
| S4 | **Doubleheader wait.** Each idle slot between a team's two games on one day | 30 |
| S5 | **Idle fields.** Each empty slot between two games on the same field on the same day | 5 |
| S6 | **Preferences.** Each `prefer` not met or `avoid` not honored, times its weight | 10 |
| S7 | **Rematch spacing.** In a second cycle, rounds between a pair's two meetings, below a target | 10 |
| S8 | **Back-to-back byes.** A team with byes in consecutive rounds | 50 |
| S9 | **Fine balance.** Sum of squared distance from each team's ideal count per time index; breaks ties between otherwise equal schedules | 1 |

Weights are part of the input, so the league can decide that field balance matters less than time balance without a code change.

## 3. Fairness metrics the admin sees

`measure` returns these. The schedule screen shows each with a status color and lets the admin open the per-team breakdown.

| Metric | Definition | Good | Review | Poor |
|---|---|---|---|---|
| Time-slot spread | Over all teams, the largest (most-used time index count minus least-used) | ≤ 1 | 2 | ≥ 3 |
| Field spread | The same, for fields | ≤ 1 | 2 | ≥ 3 |
| Longest same-slot streak | Most consecutive game days any team plays at the same time index | ≤ 2 | 3 | ≥ 4 |
| Earliest-slot share | Highest and lowest share of games any team plays in the first slot | within 15 points of each other | within 30 | wider |
| Doubleheader wait | Total idle slots between a team's two games, all teams, all days | 0 | ≤ 1 per team per season | more |
| Bye balance | Most byes minus fewest byes | ≤ 1 | — | ≥ 2 |
| Rematch gap | Fewest rounds between any pair's meetings | ≥ teams − 2 | ≥ half of that | less |
| Preferences honored | Share of soft preferences met | ≥ 80% | ≥ 50% | less |
| Unplaced games | Games with no slot | 0 | — | ≥ 1 |
| Reserve remaining | Empty slots left for makeups, by date | ≥ 1 game day's worth | some | none |

A spread of 0 is often impossible. Seven games across three time indexes cannot split evenly, so 1 is the best achievable; `measure` also returns this lower bound so the screen can say "best possible" instead of implying a flaw.

## 4. Algorithm

Four stages. The first two decide who plays whom and when in the season; the third decides which field and time; the fourth checks the result.

```
generate(input):
  rng        = seededRng(input.seed)
  pools      = groupByDivision(input.teams)              // one pool if no divisions
  rounds     = for each pool: buildRounds(pool, input.rounds, rng)      // Stage A
  repeat:                                                                // Stages B and C1
    days     = assignRoundsToDates(rounds, input, caps, pinnedRounds)
    schedule = constructPlacement(days, input)
    if a multi-round date stranded a game: cap that date at one round fewer
  until no cap changes; keep the attempt that placed the most games
  schedule   = localSearch(schedule, input, rng)                         // Stage C2
  report validate(input, schedule) in diagnostics                        // Stage D
  return schedule
```

### Stage A: who plays whom (circle method)

The circle method produces a round-robin in which each team plays every other team once in `n − 1` rounds (or `n` rounds with a bye, when `n` is odd).

```
buildRounds(teams, roundsWanted, rng):
  order = shuffle(teams, rng)                 // seed decides who sits in the fixed seat
  if order.length is odd: order.push(BYE)
  n = order.length
  cycle = []
  repeat n − 1 times:
    round = [ (order[i], order[n − 1 − i]) for i in 0 .. n/2 − 1 ]
    cycle.push(round without the pair containing BYE; record that team's bye)
    order = [order[0]] + [order[n − 1]] + order[1 .. n − 2]     // rotate all but the first
  result = []
  c = 0
  while result.length < roundsWanted:
    roundsThisCycle = (c is even) ? cycle : swapHomeAndAway(cycle)  // mirror alternate cycles
    result.append(first (roundsWanted − result.length) rounds of roundsThisCycle)
    c += 1
  return result
```

Why this satisfies H5: every cycle is a complete round-robin, and cycles are played one after another, so no pair meets a second time until every pair has met once. Stopping part-way through a cycle keeps the property. Repeating the cycle in the same order puts every rematch exactly one full cycle after the first meeting, the largest gap every pair can have at once (S7); alternate cycles swap home and away. Reversing alternate cycles would be wrong: the last round of one cycle would be replayed as the first round of the next, a rematch the following week, and on a doubleheader day the same pairs could meet twice on one date (H8).

Why H7 holds: with the dummy BYE team, each real team meets BYE exactly once per cycle, so after any number of rounds bye counts differ by at most 1.

One known quirk drives the rest of the design: the team in the fixed seat is always in the first pair of every round. If games are dealt into slots in order, that team plays the first slot on the first field every week. Stage C exists to fix that, and the example in section 9 shows it.

### Stage B: which date each round is played

```
assignRoundsToDates(rounds, input):
  dates = distinct slot dates, ascending, with regular slots
  r = 0
  for date in dates:
    capacity = regularSlots(date).count − input.reservePerDay
    gamesPerRound = floor(teamCount / 2)
    roundsToday = min(input.gamesPerTeamPerDay, caps[date], floor(capacity / gamesPerRound))
    while roundsToday > 1 and some team cannot make a different time for each
          of its games that day: roundsToday −= 1
    assign rounds r .. r + roundsToday − 1 to date
    r += roundsToday
    if r == rounds.length: break
  if r < rounds.length:
    diagnostics.push("Not enough slots: N rounds unassigned. Add dates, add slots, or lower reservePerDay.")
```

The scheduler reports a shortfall with a reason. It never drops games silently.

A round with a pinned game is played on the pin's date, and the other rounds fill the room left, so regenerating around an admin's pins rebuilds the same days for those rounds. `generate` also passes per-date caps: if a doubleheader date still strands a game in C1 (whether a day fits depends on every team's games together, which Stage B's per-team check cannot see), that date is capped at one round fewer and stages B and C1 run again. Caps only shrink, so this ends, and the attempt that placed the most games is kept. The property test P10 (more room never hurts) found both cases.

On a doubleheader day two rounds share a date. Rounds within one cycle may be reordered without breaking H5; a later Stage C2 move can use that freedom to pair rounds that give short waits (S4).

### Stage C1: a good first placement

Days are processed in order. For each day the games are assigned to that day's slots by solving a minimum-cost assignment (the Hungarian algorithm), where the cost of putting a game in a slot is how much it would worsen the season so far:

```
placementCost(game, slot, countsSoFar):
  if either team is unavailable for slot: return INFINITY
  cost  = w.S1 * (timeCount[game.a][slot.timeIndex] + timeCount[game.b][slot.timeIndex])
  cost += w.S2 * (fieldCount[game.a][slot.fieldId]  + fieldCount[game.b][slot.fieldId])
  cost += w.S3 * (lastTimeIndex[game.a] == slot.timeIndex) + same for game.b
  cost += preference penalties for both teams
  return cost
```

Slots outnumber games, so the matrix is padded with zero-cost dummy games; whichever slots receive dummies stay empty and become that day's reserve. With one game per team per day, the per-day assignment is optimal for these costs. With doubleheaders, a team's two games must not share a time index (H2), which the assignment cannot express, so C1 places the first round by assignment, then the second round by assignment over the remaining slots with conflicting slots priced at infinity. That can strand a game: the first round may take the only times a later game's teams could both make. When it does, C1 retries the day with its times split between the two rounds (every split, keeping the one that strands the fewest games), which cannot double-book a team. A split cannot always work: with three games a round on two fields, each round needs two of the three times, so the rounds must share one. If a game is still stranded, C1 searches the whole day exactly, by backtracking with H2 and availability as hard limits, the most constrained game first and the cheapest slot first, within a fixed step budget. It runs only when the greedy passes fail, and C2 improves fairness afterwards. P10 found this case with seven teams, two fields and three times.

### Stage C2: local search over the whole season

C1 is greedy across days: it cannot see that a choice in week 2 forces a bad one in week 6. C2 improves the whole season with simulated annealing.

```
localSearch(schedule, input, rng):
  current = schedule; best = schedule
  for i in 0 .. ITERATIONS − 1:
    temperature = T0 * (1 − i / ITERATIONS) + T_MIN
    move = pick one at random:
      - (80%) take a game, and swap it with the game in another slot on the
        same date, or move it there if the slot is empty. Half of these take
        a random game; half take a game of the costliest of 4 sampled teams
      - (10%) swap two whole time rows on one date (every 10:00 game trades
        places with every 11:30 game, field for field)
      - (10%) swap two whole fields on one date
    if move touches a locked game or breaks a hard constraint: continue
    delta = costAfter(move) − cost(current)            // re-price only what moved
    if delta <= 0 or rng() < exp(−delta / temperature):
      apply move
      if cost(current) < cost(best): best = current
  return best
```

- Moves stay on one date, so the round-robin order, games per day, doubleheader opponents and the makeup reserve cannot change. A move is undone when it would put a team in two games at once (H2) or in a slot it cannot make (H4). Every schedule the search holds satisfies the hard constraints, so it never has to repair anything.
- The cost is a sum of per-team parts (S1, S2, S3, S4, S6, S9) and per-field-day parts (S5); S7 and S8 depend only on rounds and do not change. A move re-prices only the teams and field-days it touches.
- Single-game moves alone stall on larger leagues. Fixing one team's time balance moves its opponent too, so it takes several coordinated moves. Row and field swaps make those big rearrangements in one step. Aiming half the single moves at the costliest teams spends the effort where the penalties are.
- `T0` is the S1 weight (100), and `T_MIN` is 0.5.
- `ITERATIONS` is fixed (default 5,000 times the number of game days), so run time is predictable and results are repeatable. On a corpus of seven realistic leagues (8 to 16 teams, 2 to 4 fields, 2 to 4 times, single games and doubleheaders, odd team counts), five seeds each, this budget brings the total of time and field spreads to 57 against a lower bound of 55. Quadrupling it gained almost nothing.
- The best schedule seen is returned, so C2 never returns something worse than C1 (P7).
- Not yet built: swapping two rounds within a cycle, which would change which date each is played and help pair doubleheader rounds with short waits (S4).

### Stage D: independent validation

`validate` re-derives every hard constraint from the output alone, sharing no code with `generate`. `generate` asserts that it returns no violations. The same function checks manual edits and is the oracle for the property-based tests.

## 5. Special cases

| Case | Handling |
|---|---|
| Odd team count | A BYE entry in Stage A. The team with the bye is listed on the schedule so nobody wonders |
| Doubleheaders (summer) | Two rounds per date. S4 keeps a team's two games adjacent. H8 holds because the two rounds are different rounds of a round-robin |
| Divisions | Each division is its own pool with its own rounds; all pools share the slot pool in Stage C, so fairness is balanced across the whole league. Crossover rounds (P3) are extra rounds built from a bipartite pairing between two pools |
| Fewer rounds than a full cycle | Stage A simply stops early. H5 holds trivially |
| More than one cycle | The cycle repeats in the same order with home and away swapped, so each rematch is a full cycle after the first meeting |
| A field lost mid-season | Its slots are marked cancelled and `reschedule` treats the games in them as postponed |
| Summer with only 2 fields | No special case. Fewer slots per day means a longer day or fewer rounds; Stage B reports any shortfall |

## 6. Manual edits

The admin can move a game to an empty slot, swap two games, pin a game, or swap two whole dates.

```
applyEdit(input, schedule, edit):
  next = apply edit to a copy of schedule
  return { schedule: next, violations: validate(input, next), metrics: measure(input, next),
           metricsBefore: measure(input, schedule) }
```

- The screen shows violations and the before-and-after metrics before the admin saves.
- Hard violations block publishing but not saving a draft, so an admin can make a two-step change that is briefly invalid.
- An edited game is pinned by default. "Re-optimize around my changes" runs Stage C2 with pins respected.
- Every save is a new draft `schedule_version`; publishing shows a diff of which games moved and which teams are affected.

## 7. Rescheduling after a rain-out

Goal: place the postponed games while changing as little as possible for everyone else.

```
reschedule(input, schedule, cancelledSlotIds, policy):
  postponed  = games placed in cancelledSlotIds
  fixed      = all other games (treated as locked)
  candidates = open slots after policy.notBefore that are empty and not cancelled
               // reserve slots first, then designated rain dates
  search placements of postponed into candidates such that:
      H1, H2, H4 hold
      no team plays more than policy.maxGamesPerDay (default 2) on a date
  minimizing, in this order:
      1. number of postponed games left unplaced
      2. idle slots between a team's two games on a makeup day
      3. fairness overflow: total amount by which any team's time or field spread exceeds 1
      4. the date of the last makeup (finish sooner)
  if unplaced > 0: diagnostics suggest, in order: add a rain date, squeeze a date, accept
  return { schedule, metrics, diff }
```

- **Search method.** A rain-out postpones at most one day of games (4 to 12), so the search is exhaustive with pruning: depth-first over postponed games, abandoning a branch as soon as it cannot beat the best found. For the example below that is 1,680 candidate placements. Above 12 postponed games it falls back to greedy placement followed by Stage C2 restricted to the makeup games.
- **Minimal change by default.** No game that was not rained out moves. A `perturbationBudget` option lets the search also move up to `k` future games when that buys back fairness; the default is 0 because people have already planned around the published schedule.
- **Squeeze day.** If reserve slots run out, the admin can re-cut a date into shorter games (for example three 90-minute slots become four 65-minute slots of 5 innings). That is `generateSlots` with a different format, followed by `reschedule`. This matches how the league already handles lost weeks.
- **Unplaced games** count toward the season's rebate threshold (see [product-spec.md](product-spec.md)).
- The result is a draft version. Nothing is published or sent until the admin confirms.
- **Makeup rules.** A rain-out version switches the season to makeup rules: a team may play two games on a date, and the makeup reserve is no longer required, because makeups exist to spend it (H6, H10). The rules are stored in the version's input, so edits that start from it are judged the same way; a fresh generation starts from the season's own settings.

## 8. Playoffs

```
placeBracket(seeds, playoffSlots):
  size   = next power of two ≥ seeds.length
  bracket = standard seeding (1 v size, 2 v size−1, ...), top seeds get byes if seeds.length < size
  for round in bracket rounds, first to last:
    earliest = 1 + latest time index used by the previous round
    place this round's matches in slots with timeIndex ≥ earliest, lowest first, balancing fields
  if a round does not fit on the date: continue on the next playoff date and report it
```

Eight teams on two fields need four time indexes on one day: quarterfinals fill two, semifinals one, the final one. Seeds come from the standings and tiebreakers at the moment the admin locks the regular season. Playoff games cannot tie, and sub requests are disabled for them, as the rulebook requires.

## 9. Worked example: 8 teams, 2 fields, 3 time slots

**Setup.** Teams A to H. Fields F1 and F2. Time slots at 10:00, 11:30 and 1:00, so six slots each Sunday. Seven Sundays, one game per team per day, `reservePerDay = 2`. Each Sunday has 4 games in 6 slots; the 2 empty slots are the makeup pool. One extra rule for this example: a field's games on a day must be back to back (S5 treated as hard).

**Stage A.** The circle method with A in the fixed seat gives 7 rounds of 4 games, 28 games, every pair once:

| Round | Games |
|---|---|
| 1 | A-H, B-G, C-F, D-E |
| 2 | A-G, H-F, B-E, C-D |
| 3 | A-F, G-E, H-D, B-C |
| 4 | A-E, F-D, G-C, H-B |
| 5 | A-D, E-C, F-B, G-H |
| 6 | A-C, D-B, E-H, F-G |
| 7 | A-B, C-H, D-G, E-F |

**Stage B.** One round per Sunday, so round `k` is played in week `k`.

**The naive placement.** Deal each round's games into slots in order (10:00 F1, 10:00 F2, 11:30 F1, 11:30 F2):

| Team | Games at 10:00 / 11:30 / 1:00 | Games on F1 / F2 |
|---|---|---|
| A | 7 / 0 / 0 | 7 / 0 |
| B to H (each) | 3 / 4 / 0 | 3 / 4 |

Team A plays the first slot on field 1 every week of the season. Time-slot spread is 7, field spread is 7, longest streak is 7. This is the fixed-seat quirk from Stage A, and it is exactly the complaint a league gets about a hand-made schedule.

**Stage C.** There are 240 valid ways to place one week's 4 games, so about 240⁷ ≈ 4.6 × 10¹⁶ for the season. Simulated annealing with weights S1 = 100, S2 = 100, S3 = 20, S9 = 1 found this schedule (each cell shows F1 / F2; `·` is an empty slot held in reserve):

| Week | 10:00 | 11:30 | 1:00 |
|---|---|---|---|
| 1 | B-G / · | D-E / A-H | · / C-F |
| 2 | B-E / A-G | H-F / C-D | · / · |
| 3 | H-D / · | A-F / · | B-C / G-E |
| 4 | · / F-D | · / G-C | A-E / H-B |
| 5 | · / F-B | E-C / G-H | · / A-D |
| 6 | · / A-C | · / D-B | F-G / E-H |
| 7 | C-H / E-F | A-B / · | D-G / · |

| Team | Games at 10:00 / 11:30 / 1:00 | Games on F1 / F2 |
|---|---|---|
| A | 2 / 3 / 2 | 3 / 4 |
| B | 3 / 2 / 2 | 4 / 3 |
| C | 2 / 3 / 2 | 3 / 4 |
| D | 2 / 3 / 2 | 3 / 4 |
| E | 2 / 2 / 3 | 4 / 3 |
| F | 3 / 2 / 2 | 3 / 4 |
| G | 2 / 2 / 3 | 3 / 4 |
| H | 2 / 3 / 2 | 3 / 4 |

| Metric | Naive | Optimized | Best possible |
|---|---|---|---|
| Time-slot spread | 7 | 1 | 1 (7 games cannot split evenly over 3 slots) |
| Field spread | 7 | 1 | 1 (7 games cannot split evenly over 2 fields) |
| Longest same-slot streak | 7 | 2 | — |
| Games per time slot, league-wide | 14 / 14 / 0 | 9 / 10 / 9 | — |
| Reserve slots | 14 | 14 | — |

Both spreads are at their mathematical minimum, so this schedule is optimal on the two headline metrics.

**Rain-out.** Week 3 is rained out. Its four games (A-F, G-E, H-D, B-C) are postponed. The empty slots in weeks 4 to 7 are:

| Week | Empty slots |
|---|---|
| 4 | 10:00 F1, 11:30 F1 |
| 5 | 10:00 F1, 1:00 F1 |
| 6 | 10:00 F1, 11:30 F1 |
| 7 | 11:30 F2, 1:00 F2 |

`reschedule` tries all 8 × 7 × 6 × 5 = 1,680 ways to place four games in eight slots, discards those where a team would play two games at once, and picks the best by the ordering in section 7. Makeups are marked `*`:

| Week | 10:00 | 11:30 | 1:00 |
|---|---|---|---|
| 3 | rained out | rained out | rained out |
| 4 | · / F-D | **H-D\*** / G-C | A-E / H-B |
| 5 | · / F-B | E-C / G-H | **B-C\*** / A-D |
| 6 | · / A-C | **A-F\*** / D-B | F-G / E-H |
| 7 | C-H / E-F | A-B / **G-E\*** | D-G / · |

What happened to the teams involved:
- Seven of the eight makeup appearances are back to back with that team's other game (for example H plays 11:30 and 1:00 in week 4).
- Team B waits one slot in week 5 (10:00, then 1:00). No placement avoids every wait; one idle slot in total is the minimum.
- All four makeups are done by week 7, no other game moved, and 4 reserve slots remain.
- Field spread stays at 1. Time-slot spread rises to 3 for teams D and H (1 / 4 / 2), because the open slots were mostly at 11:30.

That last point is the trade-off this function makes visible. The admin sees "time-slot spread 1 → 3 for D and H" in the preview and can accept it, or raise `perturbationBudget` to let the search move a few future games and restore balance at the cost of changing plans people already have.

## 10. Complexity

Let `n` be teams, `D` game days, `m = gamesPerTeamPerDay × ⌊n / 2⌋` games per day, `S` slots per day, and `I` local-search iterations.

| Stage | Time | For 12 teams, 8 doubleheader days |
|---|---|---|
| A: circle method | O(n²) per cycle | 66 pairings |
| B: rounds to dates | O(D) | — |
| C1: assignment per day | O(D × max(m, S)³) | 8 × 12³ ≈ 14,000 steps |
| C2: local search | O(I), constant work per move | 160,000 moves |
| D: validation | O(games) | 96 games |
| `reschedule` | Exhaustive up to 12 postponed games, pruned; otherwise as C2 | Thousands of placements |

Memory is O(n × (time indexes + fields)) for the counters plus the schedule itself.

The general problem (sports timetabling with fairness objectives) is NP-hard, which is why Stage C2 is a heuristic with a fixed budget and not an exact solver. At this league's size the heuristic reaches the provable lower bound in the example above. Target: `generate` returns in under 300 ms for 24 teams and 12 game days inside a Vercel function, so it runs in the request with no background job. A benchmark test guards that number.

If the league grows past roughly 40 teams in one pool, the right move is divisions, which the model already supports, not a faster solver.

## 11. Test strategy

The scheduler is pure, so it is tested without a database, a browser or mocks.

### Property-based tests (fast-check)

A generator produces arbitrary valid inputs: 4 to 24 teams, 1 to 4 fields, 2 to 6 time indexes, 4 to 14 dates, random blackout dates, one or two games per team per day, random unavailability and locks, any seed. For every generated input:

| Property | Statement |
|---|---|
| P1 Valid | `validate(input, generate(input))` is empty |
| P2 Round-robin order | At the end of every round, pair meeting counts differ by at most 1 within a pool |
| P3 No double booking | No slot holds two games; no team is in two games at one time index on one date |
| P4 Accounted for | Every game from Stage A is either placed in exactly one slot or listed in `unplaced` with a diagnostic |
| P5 Byes | With an odd team count, each round has one bye and bye counts differ by at most 1 |
| P6 Deterministic | The same input gives a deeply equal output, twice |
| P7 Search never hurts | Cost after C2 ≤ cost after C1 |
| P8 Locks hold | Every locked game is in its locked slot |
| P9 Reserve | Each date keeps at least `min(reservePerDay, spare)` empty slots |
| P10 More room never hurts | Adding an empty slot to a feasible input leaves it feasible |
| P11 Labels do not matter | Renaming teams (a permutation of IDs) yields a schedule that is still valid and whose spreads are within 1 of the original |
| P12 Minimal change | After `reschedule`, every game that was not postponed is in the same slot as before, and each postponed game appears exactly once (placed or unplaced) |
| P13 Edits are honest | `applyEdit` returns exactly the violations that `validate` finds on the edited schedule |
| P14 Slots respect permits | Every slot from `generateSlots` lies inside a permit window, outside every blackout, and overlaps no other slot on its field |

When a property fails, fast-check shrinks the input to the smallest failing case and prints the seed, which goes straight into a regression test.

### Example tests

- The 8-team example above as a snapshot: rounds, final metrics (spreads of 1 and 1), and the rain-out result.
- Hand-checked small cases: 4 teams, 5 teams (byes), 12 teams with doubleheaders on 2 fields.
- Infeasible inputs return diagnostics and do not throw: too few slots, a team unavailable every date.
- Quality floor on a fixed corpus of about 30 realistic inputs: time-slot and field spread ≤ 2, and ≤ 1 wherever the lower bound is ≤ 1.

### Other checks

| Check | Tool | Purpose |
|---|---|---|
| Mutation testing on `src/domain/scheduler` | Stryker | Proves the tests fail when the logic is wrong; target 85% mutation score |
| Benchmark | Vitest bench | `generate` under 300 ms for 24 teams, 12 dates |
| Coverage | Vitest | 100% of lines and branches in the scheduler module |
| Integration | Vitest + a Neon branch | Publishing a version writes placements and `game.slot_id` in one transaction |
| End to end | Playwright | Admin generates, edits, publishes; a rain-out produces a new version and emails |

## 12. Known limits

- Time balance is measured by time index (first slot, second slot), not clock time. If fields have different start times on one day, indexes are assigned by clock order across all fields.
- Travel between parks is not modeled. It will matter when a second park is added; the cost function has room for a term per team per day.
- Referee assignment is a separate, simpler problem (assign available refs to placed games, balancing games per ref) and is not part of this function.
- Home and away are not balanced because the rulebook decides them by rock-paper-scissors at the field.
