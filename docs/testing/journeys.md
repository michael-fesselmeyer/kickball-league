# End-to-end journeys

Per-feature specs live in `e2e/flows/`. A journey crosses features the way people use the league across a season. This page lists the journeys the league has, which spec covers each, and what is still open. Journey specs run at phone width where the page is built for phones, scan every new screen with axe (WCAG 2.2 AA) and use synthetic `example.test` data only. They share the seeded league, so each one resets or adds the games it uses and never touches another journey's games.

## Covered

| Journey | Spec |
| --- | --- |
| A new player signs up, is turned away under 18, signs the waiver, pays the early-bird price, brings a friend through a referral link and is placed on a team | `journey-player.spec.ts` |
| An admin creates a season, adds fields, permits and slots; a captain registers with split pay; a teammate pays a share; a free agent is placed; the schedule is published; a sub is picked up; scores are confirmed; the last game day is rained out | `season-journey.spec.ts` |
| A captain reports a score, the other confirms, standings move, a sportsmanship rating and an incident reach the admins | `journey-captain.spec.ts` |
| An admin settles a missing score, sends the recap and posts a team-only event | `journey-admin.spec.ts` |
| An owner reviews the books and an admin who is not an owner cannot | `journey-owner.spec.ts` |
| A ref is assigned, checks the permit and kicking orders, reports a score and a captain confirms it | `journey-ref.spec.ts` |
| The operator's site-wide switches | `site-wide/journey-operator.spec.ts` |
| A ref says when they can work, an admin accepts the proposal and pays them | `ref-assigner.spec.ts` |
| A player scans the field check-in code and the captain sees them | `field-check-in.spec.ts` |
| A ref keeps score live and a spectator follows it | `live-score.spec.ts` |

## Added by the journey pass

| Journey | Spec |
| --- | --- |
| A captain disputes a reported score, the admin settles it from the Disputed list, and the standings and both captains show the admin's score | `journey-dispute.spec.ts` |
| A player says they are in for next week's game, the captain builds the kicking order, the player sees where they kick, then changes to out | `journey-rsvp.spec.ts` |
| One game from the first player at the field to the confirmed score: the captain shows the check-in code, a player scans it, the assigned ref keeps score live and ends the game, the other captain confirms | `journey-game-day.spec.ts` |
| An admin rolls a season over, finds the permit hours on the new dates, cuts slots, generates a schedule and publishes it | `journey-rollover.spec.ts` |
| An admin seeds a four-team bracket from the standings, publishes it, sets each playoff score (a tie is refused), and the champion shows on the admin page and the public bracket | `site-wide/journey-playoffs.spec.ts` |

## Notes

- A ref's pay is covered end to end by `ref-assigner.spec.ts`: availability, assignment, the pay sheet, the books entry and the ref's own page showing the payment.
- The playoffs journey runs with the site-wide flows, alone and after the rest, because publishing a bracket moves the shared fall season into playoffs. It adds its own playoff-evening slots, since the seeded season has none after its last game.
- Still open: a captain's team registration journey that ends in a kicking order is covered in two halves (`season-journey.spec.ts` for registration and split pay, `lineup.spec.ts` and `journey-rsvp.spec.ts` for the order), not as one run.
