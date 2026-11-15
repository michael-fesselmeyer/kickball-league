# ADR 0073: A ref's ejection is an incident, and a full season is counted in games

- Status: accepted
- Date: 2026-11-15

## Context

The league's rules take an ejected player out of the kicking order and off defense for the rest of the game, and leave anything more to the league. Refs had no way to record an ejection while keeping score, and the kicking order kept showing the player. Admins deciding on a suspension couldn't see whether the player had been ejected before. For a second outside-alcohol report the league's rules call for one full season out, while the app suggested only the rest of the current season.

## Decision

**An ejection from the live game screen is an ordinary incident of kind "ejection", filed by the game's ref (or an admin), and the kicking order reads it.**

- The ref uses "Eject a player" on the live game screen (permission `player.eject`: the game's ref or an admin, never a captain). It files an incident naming the player, with an optional reason, and admins review it like any other report. A player is ejected from a game once.
- No new table. The players out of a game are the people named on its ejection incidents filed by a ref or an admin. A captain's report of an ejection doesn't take anyone out, because a captain can't eject. The saved kicking order drops them and the others move up; the lineup builder no longer offers them.
- On a report, each person shows their earlier ejections with the date, season and what the report said. The app suggests no ban from that history; the admin decides.
- **One full season is a games suspension** as long as the player's team's regular season (its regular games, cancelled ones left out, at most 20). Games served are counted from the player's team games after the suspension starts (ADR 0026), so it runs on into the next season. With no count, the suggestion falls back to the rest of the season. It is still only a suggestion.

## Consequences

- Ejections and suspensions share one review queue and one audit trail.
- A ref who ejects the wrong player asks an admin to resolve the report; the player stays out of that game's order. Correcting it is rare enough not to need its own control.
- A season's length in games changes as the schedule does; the suggestion uses the count when the admin opens the report.

## Alternatives considered

- **A game-level "ejected" list.** It would need a migration and would duplicate the report the league reviews anyway.
- **A new suspension scope for "next season".** It would need a migration and rules for when a player skips a season; a games count already carries across seasons.
