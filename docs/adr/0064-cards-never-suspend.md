# ADR 0064: Cards are a calm-down tool and never suspend anyone

- Status: accepted
- Date: 2026-11-15

## Context

Refs asked for a light way to cool a game down without turning it into a punishment. Incident reports and suspensions already exist, but they are heavy: a report is a written account that admins review, and a suspension keeps a player out of games.

## Decision

A ref (or an admin) can give a player a yellow card (a warning) or a red card (asked to sit out the rest of the game) from the score screen, with an optional note of up to 200 characters. A card is a row in `game_card`.

- A card never creates, suggests or counts toward a suspension. No code path turns cards into a suspension, and the pattern note says so. Suspensions stay a manual admin decision, kept for serious conduct: hurting someone, sexual misconduct, or repeated behavior that makes someone deeply uncomfortable.
- Admins read cards beside incident reports. A gentle pattern note appears only from three cards across three different games, so one rough night is never a pattern.
- A red card is a request to sit out, not a lock: the app does not block the player from the field or from RSVPing.
- A card can be given from kickoff until two days after, so a ref can record one after the game, and not for a called-off game. The ref can take back their own card for five minutes; an admin can at any time. Both are audited.
- A player sees their own cards on their profile and in their data export. Cards never appear on a public page or to captains or other players.

## Consequences

Refs get a quick tool with no paperwork. The cost is that cards carry no automatic consequence, so the league relies on admins to notice a real pattern, which the Cards page and incident review make easy to see.
