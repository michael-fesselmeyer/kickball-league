# ADR 0012: Free-agent matching and teams built from the pool

- Status: accepted
- Date: 2026-11-12

## Context

Many players sign up alone or with a couple of friends. Admins placed every free agent by hand from a list, with nothing to go on but names. The roadmap (section 4, milestone 5) asks for a quiz under two minutes, friend codes that keep groups together, a matcher that suggests placements with reasons and passes its own property tests, and a way to build a new team from the pool.

Three questions needed an answer: what the matcher optimizes, whether it decides or only suggests, and what players on a team built from the pool pay.

## Decision

**The matcher suggests; an admin applies.** It is a pure, deterministic function in `src/domain/matcher`. The admin page shows each suggestion with up to three plain-language reasons and applies one or all of them in a transaction. Placing someone by hand stays on the registrations page.

**Hard rules first, then a score.** Friend groups move as one unit and are placed first, largest first; a group with someone already on a team goes to that team or nowhere. A team never goes past its capacity: the captain's target roster size, capped by the season's maximum. Among the teams with room, the score ranks:

1. **The fielding rule.** Each team wants half its capacity from each side of the rule (women and men, by the fielding group in each profile), so it can field a full lineup on a night when some players are away. A team's shortfall is how far below that it is on each side, squared, so the team furthest short feels it most. Placements go where they cut a shortfall the most. This term outweighs all others put together.
2. **Open spots**, by expected game-day turnout (from each player's answer about how many nights they can make), so teams fill evenly.
3. **Vibe, experience and positions**: a similar vibe, pulling a team's average experience toward the league's, and a pitcher or catcher where nobody has claimed it.

Adding players never raises a shortfall, so every team's fielding balance improves or holds. The property tests check that, plus groups staying together, capacity holding, each single player going where they cut a shortfall the most, and determinism.

**Players on a team built from the pool keep paying the free-agent fee.** The new team starts "forming" with the chosen captain. Its players keep `registration.kind = free_agent`, so checkout charges each of them the free-agent fee, which many have already paid. Per team, the team uses split pay with the free-agent fee as its fixed share, so anyone the captain invites later pays the same. The captain is not charged a team fee.

## Alternatives considered

- **Even out women and men (smallest |women − men|).** The first version did this. It made a team with a few players more attractive than an empty one, so a whole pool piled onto one team. Measuring the shortfall against each team's need fixed it.
- **An optimal assignment (integer programming or a solver).** Better on paper, but harder to explain in a sentence per suggestion, and pools are small enough that a greedy pass with groups first does well.
- **An AI model to rank fits.** Not needed for five structured answers, and the reasons would be harder to test.
- **Charge the captain of a pool-built team the team fee.** Unfair to a volunteer who joined alone, and players who already paid the free-agent fee would be double-charged or need refunds.

## Consequences

- Nothing is placed until an admin applies it, so a bad suggestion costs a click, not a wrong roster.
- Suggestions depend on profiles and quiz answers. Players without a fielding group or without a quiz are matched on what is known, and the pool table shows who has not answered.
- A pool-built team's registrations say `free_agent` even though they are on a team; "free agent" as a state is still "not on a team", which the roster decides.
