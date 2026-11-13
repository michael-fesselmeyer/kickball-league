# ADR 0021: Kicking orders count the side each player chose, and wrap around

- Status: accepted
- Date: 2026-11-13

## Context

Rulebook 2.2.4 says no more than 2 players of the same gender kick in a row ([product-spec.md](../product-spec.md), section 2). The lineup builder has to check that live, explain it, and arrange an order that keeps to it. Three readings were open: how players who are neither women nor men count, what to do with a player who has not filled in their profile, and whether the order wraps from the last kicker to the first.

## Decision

**A player counts toward the side they chose.** The profile already asks every player how the fielding rule should count them (`profile.lineup_gender`, woman or man): set from their gender when that is woman or man, and chosen by the player otherwise. The kicking-order rule uses the same answer. Nobody else assigns a side, so a non-binary player is never placed in a group they did not pick. A pickup counts by the side copied to their sub claim.

**A player with no side counts toward neither.** Until a player fills in their profile, `lineup_gender` is empty. Such a player never makes a run and breaks one: two women, then a player with no side, then two more women keeps to the rule. This is the most inclusive reading, since it never guesses someone's gender, and the builder names these players to the captain and asks for the profile to be finished. The ref has the final word on the field.

**The order wraps.** Kicking goes back to the top of the order, so the last two kickers and the first count as neighbours. A run that crosses the wrap is reported once, in words that say so ("counting from the last kicker back around to the first").

**Pickups kick last** (rulebook 2.1.4). The builder puts approved pickups after the team's own players and flags a pickup placed earlier.

**The site warns, it does not block.** A captain may save an order that breaks the rule; the saved order records how many runs it has, and the ref and the other captain see that count, never anyone's side. This matches product-spec.md, section 7.

**Auto-arrange changes as little as it can.** It walks the order and, at each spot, takes the earliest remaining kicker who still lets the rest be finished within the rule, checked by a memoized search over how many of each side are left and the runs at both ends. An order that already keeps to the rule comes back unchanged, and each side's players keep their relative order. When no order exists it says why: too many players of one side (with how many more of the other side would fix it), or the pickups having to kick last.

## Alternatives considered

- **Count players with no side as a third group that can also run.** Simpler to explain, but three unrecorded players in a row would be called a break of a rule about gender that nobody stated.
- **Refuse to build an order until every player has a side.** It blocks a captain on game day because of someone else's profile.
- **Ignore the wrap.** Easier, but the rulebook's order repeats, and refs check the turn from the last kicker to the first.
- **Block saving a broken order.** The ref, not the site, rules on the field; a blocked save leaves a captain with no order at all.

## Consequences

- Lineup genders stay visible only to a team's captains and admins (data-model.md, section 4). Refs and the other captain see names and a count of rule breaks.
- Auto-arrange is exact for any roster size the league has; property tests compare it with brute force on small rosters and check that it is stable.
- If the league later reads the rule differently for players with no side, only `runBreaks` and the search's label for them change.
