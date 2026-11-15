# ADR 0063: Written rulings on forfeits and disputed scores

- Status: accepted
- Date: 2026-11-15

## Context

An admin could settle a disputed score or record a forfeit with no explanation. The teams saw only a new result, and a later change to it could surprise them. The public pages need to show that a result was ruled on, but a reason can name players and teams and has no place in public.

## Decision

**A ruling is an admin's score report with a written reason.**

- `score_report.reason` holds it (1 to 300 characters, admin reports only, enforced by a check). A reason is required for a forfeit and for any admin score that follows an earlier report or a final result, which covers settling a dispute, overriding a report, and correcting or reversing a forfeit or a final score. An admin's first score on a game nobody reported needs none.
- Reports stay append-only, so every ruling and reversal is kept with its reason and its author, and the audit log records each as `game.forfeit`, `game.forfeit_reversed` or `game.ruling` with the result before and after.
- `game.ruled_at` is set when the result that settles the game is a ruling, and cleared when a later result is not one. The public game page, schedules and cards read it to say "Ruling"; a forfeit already says "Forfeit". They never read the reason.
- Both teams' captains and co-captains and the game's accepted ref get an urgent `game_ruling` message with the result, the result it replaces and the reason. The game page shows the same to them and to admins. A person who is both a captain and the ref is told once, and each new ruling on the same game tells everyone again.
- A ruling needs a signal: the offline outbox does not keep a reason, so an admin's ruling is refused offline and the form says so.
- A ruling after the season has ended is allowed, as any correction is. It expires the season's public pages, and the standings, which are computed from results, change with it.

## Alternatives considered

- **A separate ruling table.** It would repeat the report's author, time and result, and a ruling would no longer be the thing that settles the game.
- **Showing the reason publicly.** Rejected: it can name people, and the people who need it are the teams and the ref.
