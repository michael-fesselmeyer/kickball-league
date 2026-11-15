# ADR 0072: A league plays one sport, and the sport's rules live in code

- Status: accepted
- Date: 2026-11-15

## Context

The league is adding touch football, dodgeball and a winter darts and pool night, and it wants to open more kickball leagues on new nights and in new parks. Several leagues already run on one deployment ([ADR 0048](0048-several-leagues-on-one-deployment.md)), and each league row has had a `sport` since then, but everything that touches a result assumes kickball: scores are runs, a game called early needs four complete innings, live scoring counts half-innings, the standings show runs and cap the run difference at 10, and the game screens talk about fields in parks.

Most of the app does not care which sport is played: registration, payments, waivers, rosters, messaging, events, the schedule, score reports and their confirmation, standings order, playoff brackets and awards. The question is where the differences go, so that a new sport is a small, contained change and the kickball leagues do not change at all.

## Decision

**A league plays one sport. Each sport is a module in `src/domain/sports/` that answers every question a screen or query asks about the sport's rules. Kickball is the default, and it is also what a league gets for a sport that has no module yet, which is what every league gets today.**

### What varies by sport

Each sport module (`SportRules`) says:

- **Scoring unit.** What a team's number is (runs, sets won, points, games won), with the words and abbreviations the screens use ("runs", "RF/RA").
- **How a result is checked.** A function from the reported score to field errors, given whether ties are allowed (never in the playoffs) and the match length. Kickball keeps its existing rules exactly: 0 to 99 runs, a called game counts after 4 complete innings.
- **Periods.** Innings for kickball, nothing for a set-based sport, whose sets are the score itself. Whether the sport has live scoring (only kickball's half-inning screen exists).
- **Match length.** For set-based sports, best of N sets. N is on the rule set (`rule_set.best_of`, odd, 1 to 9), next to kickball's innings; a game reads the rule set of team A's division, as the permit watch already does, then the league's first rule set that sets one, then the sport's default.
- **Standings difference.** Kickball caps run difference at 10 a game so a blowout can't decide a tie. Sets are bounded by the match length, so the set difference has no cap. The tiebreaker keys stored on a season stay the same (`run_difference`, `runs_allowed`) and the sport names them ("set difference", "sets allowed"), so no season data changes.
- **Where it is played.** A field in a park (outdoors, weather and permits matter) or a court or table indoors. The `venue` and `field` tables stay: a field row is a playing area, whatever the sport calls it.
- **Roster rules.** Whether the gender rule for who is on the field applies; it is kickball's (`fieldingRules.maxPerGender`), off for sports without it.

### What stays shared

Registration, payments, credit, waivers, rosters and captains, messaging and its limits, events, the schedule and its slots, score reports with their confirm-or-dispute flow and 24-hour finalizing, forfeits, standings order (win percentage, a tie as half a win, then the season's tiebreakers), divisions, playoff brackets, awards and history. A score is still two numbers on the game row (`score_a`, `score_b`), in the sport's unit.

### How kickball stays unchanged

- `league.sport` already defaults to `kickball`, and the existing names (`checkScore`, `MIN_CALLED_INNINGS`, `MAX_RUNS`, `RUN_DIFFERENCE_CAP`) are still exported from where they were, now backed by the kickball module. Every existing test passes as it was written.
- A sport without its own module (flag football, softball, soccer, volleyball, other) keeps kickball's rules, as it does today. Its module is added when a league of that sport opens; the operator's sport list says which sports have their own rules.
- The migration adds nullable columns only (`rule_set.best_of`, `interest_option.opened_league_id`); no existing row changes.

### Dodgeball, end to end

Dodgeball is the first sport after kickball, chosen because it differs the most in the ways that matter (sets, no innings, indoors) while needing nothing new from the shared parts:

- A match is best of N sets, 5 by default. Played to the end, the winner has won a majority (3 of 5) and the loser fewer. Called early (the gym time ran out), neither side reached the majority and the sets stand as they are; a level called match is a tie in the regular season and refused in the playoffs. A forfeit works as for kickball.
- The score screen asks for sets won, offers no innings and no live scoring; the standings show sets for, against and the set difference, uncapped.
- It is played on a court indoors. The gym and its courts are entered as a venue and its fields; screens that only make sense outdoors (rain-outs, the daylight clock, field check-in, the permit watch) are turned off for indoor sports as follow-ups, one screen at a time.

### Opening a new league from interest sign-ups

When an option of the interest sign-ups has enough interest, one action opens it as a new league with a draft season: the league is named after the option ("Thursday Social Kickball at McCarren Park"), plays the sport picked when opening it (the asking league's by default, so a form can gauge a new sport too), copies the asking league's colors, time zone and minimum age, and gets a rule set with the sport's defaults. The draft season starts on the option's night at least six weeks out, runs eight weeks, takes the asking league's latest fees and roster sizes, and is capped at the form's target number of teams. The option keeps a link to the league (`interest_option.opened_league_id`), so it opens once. Creating a league stays an operator action ([ADR 0048](0048-several-leagues-on-one-deployment.md)); the button is on the league's interest page, for the operator only. Nothing is public until an admin opens registration. The rules for the draft are pure (`src/domain/league/draft-league.ts`).

## Alternatives considered

- **Sport rules as data in the database** (a `sport` table with JSON rules). Rules carry logic (what makes a valid result, how to count a called game), so most of a sport would be code anyway, and the data would need its own editor and validation. A fixed list in code is checked by the type system and the tests.
- **Sport on the season instead of the league.** A league that mixes sports would need sport-aware standings history, awards and records across seasons, and its public pages would mix them. One sport per league keeps every league's history comparable; a new sport is a new league, which players already switch between.
- **Columns per sport on the game** (sets for A and B, points, frames). Every result is two numbers in some unit, and the standings and brackets only need those. Set-by-set detail can come later through `game_period`, which was named for periods so another sport could use it.
- **A generic "points" scoring for the sports without a module.** It would change the score screens of any existing league whose sport is not kickball, which still plays by kickball's rules. Each sport gets its own module when it opens instead.

## Consequences

- A new sport is a module, its tests and its words; the schema changes only when the sport needs a setting the rule set does not hold.
- Screens and queries ask the sport for words and rules rather than assuming kickball. The first slice moves the score screen, score checks and standings; other screens (live scoring, history, emails, outdoor-only screens) follow as each sport needs them, and until then show kickball's words.
- Touch football (points, two halves, a point-difference cap) and the darts and pool night (games won in a match, like sets) fit the same shape.
