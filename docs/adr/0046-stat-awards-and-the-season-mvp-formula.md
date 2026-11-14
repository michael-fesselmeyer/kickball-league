# ADR 0046: Stat awards and the Season MVP come from what the app records, with every formula published

- Status: accepted
- Date: 2026-11-14

## Context

At the end of each season the league hands out its annual awards. Players already vote in award polls (weekly and season), but the league also wants awards that come straight from the numbers: a Season MVP, best attendance, most runs, the best teammate, the best rookie and the most reliable sub.

The app does not keep a box score. What it records:

- **Final scores**, and for live-scored games the **runs in each half-inning** (ADR 0011). Runs belong to the team, not to whoever kicked.
- **Kicking orders** a captain saved, **RSVPs**, and **bar check-ins** on game days. None of them is a roll call, and many games have none.
- **Sportsmanship ratings** one captain gives the other team after a game, again per team.
- **Sub claims** a captain approved, and **closed polls**.

Two things follow. Any stat built from these is uneven: some teams save orders every week, some never do. And most of the numbers are shared by a whole team, so teammates come out level unless something individual separates them. A formula nobody can check would make the awards feel arbitrary, and a formula that quietly favors players with less data would make them unfair.

## Decision

**Six stat awards are worked out from those records with formulas the awards page prints in full, admins review and publish them, and players can stay off the page.**

- **Attendance per game, best evidence first.** A saved kicking order decides whether a player played; without one, their RSVP ("in" or "out"); without that, a bar check-in on the game day counts as there. Otherwise the game is unknown and left out of the player's rate (`attendanceAt`).
- **Shown only with enough coverage.** A stat appears once at least 3 games, and at least half of the games, recorded it, always with "based on N of M games". Runs are the team's runs in live-scored games the player played, and every page says the app doesn't record who kicked them in.
- **The Season MVP is a weighted score out of 100** from four parts: runs per live-scored game, wins while playing as a share of the team's games, attendance rate, and share of the season MVP poll's votes. Each part is the player's number divided by the season's best, so the leader in a part gets its full weight. The weights are an admin setting (0 to 10 each), saved with the season's awards and printed on the page. The default is runs 2, wins 2, attendance 2, votes 4: runs and wins are the team's, so the player's own parts (attendance and the vote) carry more than half.
- **Missing data neither helps nor hurts.** A part a player has too little data for (their games weren't live scored, say) counts at the season's average for that part. A part nobody has data for (no MVP poll closed) is left out for everyone and the page says so. The MVP, Rookie of the Year and Best Teammate need at least 3 games played.
- **The other awards.** Iron Kicker: best attendance rate, a tie going to whoever played more games. Golden Boot: most runs while playing. Best Teammate: half the team's sportsmanship rating in games played, half best-sport votes across the season's closed polls. Rookie of the Year: best MVP score among players in their first season with the league. Sub of the Year: most approved sub spots.
- **Ties share.** Values are compared as shown (one decimal place); everyone tied for first wins. The page names up to four winners and counts a bigger tie.
- **Admins review, then publish.** Working the awards out saves a draft (`stat_award_set` and its `stat_award_place` rows, the top three places with ties). Admins see it at once, can add a note to each award, and publish; recomputing a published set needs taking it down first. A season MVP, best-sport or best-newcomer poll lists the draft's leaders first as suggested nominees.
- **Opting out.** A player who opts out (`leaderboard_opt_out`) is left out of the computation and never listed, even on a set published before they opted out. Their own stats page still shows everything to them.
- **Static and public-safe.** `/seasons/[season]/awards` is static HTML under the season's tag, which publishing, taking down, a note and an opt-out expire. It shows first names and last initials, teams and the numbers behind each place, never anything private.

## Alternatives considered

- **Record runs per kicker.** The fairest Golden Boot, but the live scorer would have to tap a name for every run, between innings, on a phone at the field. Live scoring stays per half-inning.
- **Leave a missing part out and share its weight among the others.** Simple, but it favors players with less data: one whose games weren't live scored dodges a weak runs part. Tried first and dropped when a player with two games topped the demo season.
- **Count a missing part as zero.** Punishes players for their captain not saving orders or the ref not live scoring.
- **Votes only.** The existing polls already do that. The stat awards add what voting misses: who showed up every week, and how the team did with them there.
- **Compute on every page view.** Always current, but the numbers could change under a published winner. A saved, reviewed copy matches what admins approved.

## Consequences

- Teammates share team-level numbers, so in a short season or a dominant team's year several players can tie. The page handles big ties, and the default weights lean on the individual parts.
- The awards are only as good as the records. Captains who save kicking orders and refs who live score make them sharper, which the coverage notes make visible.
- The weights a season was published with stay with it, so a later change to the defaults never rewrites a past season.
