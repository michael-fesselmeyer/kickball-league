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

## Still open

- **Playoffs, end to end.** Seeding a bracket needs a season whose regular games are all final and free slots after them. The seeded fall season is shared by every flow and its status and standings can't change under them, so this journey needs a season of its own built through the screens, as `season-journey.spec.ts` does, with scores entered for every game.
- **Rolled-over season to published schedule.** `rollover.spec.ts` stops at the draft season. Carrying on (teams re-register, slots added, schedule published) repeats most of `season-journey.spec.ts` and belongs in it once the season builder helpers are shared.
- **Player to field, on game day.** Check-in, kicking order and live scoring each have a spec; one run through all three on the same game needs a game at today's date with a ref, which `addRefereedGameSoon` can place.
- **A ref's pay after the season.** Covered up to the pay sheet in `ref-assigner.spec.ts`; the ref's own view of what they were paid is not.
