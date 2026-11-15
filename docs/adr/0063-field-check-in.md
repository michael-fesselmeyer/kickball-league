# ADR 0063: Field check-in with a per-game rotating code

- Status: accepted
- Date: 2026-11-14

## Context

The league had RSVPs (who said they'd come) but no record of who actually played. Captains want attendance, admins want a games-played count for playoff eligibility (a season may require, say, three games), and the ref wants to know at the field whether someone playing hasn't signed the season's waiver. Subs and pickups play too, and their games should count.

A check-in only means something if the player was at the field. The league has no hardware there, players won't install anything, and fields often have weak signal.

## Decision

**The sponsor check-in's rotating code, under a key per game.** The game's ref or a captain opens `/app/games/[game]/attendance/code`, which draws a QR code on the server for `/app/games/[game]/check-in/<code>`. The code is the sponsor check-in's (ADR 0016): an HMAC of the 5-minute window, accepted for that window and the one before. Its key is derived with HKDF from the server's auth secret and the game's id (`fieldCodeKey`), so no secret is stored per game, a game's code says nothing about another game's, and no field code works as a sponsor or giveaway code. It shows on game day only, in the league's time zone.

**Checking in is a tap, checked again on the server.** The link opens a page with a Check in button. The Server Action checks the code, the game day and that the player is on either team's active roster or is an approved sub for that game, then records one `game_attendance` row for the team they play for. The primary key `(game_id, user_id)` makes a second scan change nothing. Opening the link, a link preview or a prefetch records nothing.

**Captains, the ref and admins can tick players in or out.** The check-in screen (`/app/games/[game]/attendance`) lists both rosters and the game's approved subs, with each one's waiver status; anyone checked in without the season's current waiver is listed at the top. Ticks can be changed from game day until 7 days after it, so a captain with no signal at the field can do it that evening; admins can correct the record at any time. Only people the form showed as checked in can be taken off, so a player who scans while the captain is saving stays checked in. Every change writes one `attendance.mark` audit row with the ids added and removed.

**Games played are counted, not stored.** A player's games played are their check-ins in the season's games, for any team, compared with `season.playoff_min_games` (1 to 30, or none). Captains see their team; admins see every team.

**Not queued offline.** The score outbox (ADR 0025) is built around score entries and a service-worker queue; extending it to check-ins would add a second kind of offline write for little gain. A player scanning needs signal to tap Check in; when the field has none, the captain ticks players in later from the check-in screen, within the week.

## Alternatives considered

- **A secret column per game,** as the giveaway does. Works, but needs a migration step to fill every game and one more secret in the database; a derived key needs neither.
- **Counting RSVPs as attendance.** Free, but an RSVP is a plan, not a fact, and eligibility rules turn on who played.
- **Captains only, no scanning.** Simplest, but slow for a captain who is also playing, and easier to pad for a friend.
- **Queueing scans offline.** The phone showing the code is often the one with no signal too, and the player's phone needs the server to check the code; the captain's later ticks cover the gap.

## Consequences

- Rotating the auth secret changes every game's code; codes on screen at that moment stop working at the next refresh, as sponsor codes do.
- The phone showing the code must stay open; the page asks to keep the screen awake and refreshes as the code turns over.
- Check-ins are personal data: the player's export lists them, deleting the account deletes them, and merging accounts keeps one per game.
- A captain can tick in a teammate who wasn't there. The audit log records who did, and admins can correct it.
