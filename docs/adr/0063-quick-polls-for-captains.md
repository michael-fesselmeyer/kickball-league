# ADR 0063: Quick polls for captains are their own small poll, one vote per team

- Status: accepted
- Date: 2026-11-15

## Context

Some league decisions need a fast answer from the captains: playoff innings, a makeup date, a format. Answers were collected by hand and got lost. Awards polls already have open and close rules, a closing time in the league's time zone and an audit trail, but they ask players to pick a person or a team, and each person votes once and can't change it.

## Decision

**A captains' poll is its own set of tables that reuses the awards poll's rules, and a vote belongs to a team, not a person.**

- `captain_poll` holds the question, an optional note, whether co-captains may vote, when captains see totals (`after_voting` or `at_close`), and `opens_at` and `closes_at`. `captain_poll_option` holds two to five options in order. `captain_poll_vote` is unique on `(captain_poll_id, team_season_id)`.
- Opening, closing early and the closing-time check are the awards poll's (`pollState`, `zonedInstant`, closing sets `closes_at` to now), so the two behave the same.
- Because a vote is one row per team, a captain changing it, or a co-captain answering differently, overwrites the row: the last answer wins. The row keeps who cast it, so the other captain sees "another captain cast this vote".
- The electorate is read when needed, never copied at opening. A team added after the poll opens can vote; a team that withdraws stops counting and its vote leaves the totals. Teams without a captain simply never vote, and admins see them in the list.
- A vote takes a share lock on the poll row, and closing early takes an update lock, so a vote can't land after a close.
- Admins see totals and each team's answer as votes arrive. Captains see totals once their team has voted, or only at close, as the admin chose.
- Reminders reuse the outbox: one `captain_poll` message (non-urgent, topic `announcement`) goes out when a poll opens, and a reminder goes to the captains of teams that have not voted, from a daily job for polls closing within a day or from an admin's button. The dedupe key holds the local date, so a captain gets at most one reminder a day per poll. As a non-urgent kind it waits out quiet hours and counts toward the daily limit ([ADR 0019](0019-urgent-and-non-urgent-messages.md)).

## Alternatives considered

- **Reuse `award_poll` and `award_vote`.** Awards votes name a person or a team and are one per person and final. Bending them to options and per-team, changeable votes would loosen constraints the awards rely on.
- **Copy the electorate at opening.** It would stop a late team from voting and need repair whenever a captain changes mid-poll.
- **Count one vote per captain.** A team with a co-captain would count twice; the league decides by team.
