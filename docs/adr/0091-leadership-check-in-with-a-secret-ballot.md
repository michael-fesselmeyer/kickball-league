# ADR 0091: A season-end leadership check-in with a secret ballot

- Status: accepted
- Date: 2026-11-15

## Context

Teams sometimes want a change in who leads them. Until now the only paths were the captain handing the team over ([ADR 0042](0042-captain-handoff-and-co-captains.md)) or an admin editing the roster. A player who wanted a change had to say it out loud, usually in the group chat, which turns a small question into a public argument and puts the captain on the spot.

The league wants a calm way to ask "who'd like to help lead next season?" that:

- happens for every team at the same moment, so nobody "starts a vote against" their captain;
- only happens between seasons, never in the middle of one;
- keeps every nomination and every vote secret, from teammates, the captain, admins, owners and the operator alike;
- lets the current captain hear the result first and choose how to hand over, through the flows that already exist.

## Decision

### One check-in per team per season, opened by an admin at season end

An admin opens the check-in for a whole season at once (`leadership.manage`), only while the season is in its playoffs or completed. Every team in the season that has an active roster gets one `leadership_check_in` row; a unique key on the team season makes it once per team per season. The admin picks when the check-in closes (3 to 14 days, a week by default). Because it is a season ritual for every team, a check-in never says anything about a particular captain.

The quorum is a league setting, `league.leadership_quorum_percent` (50 to 100, 60 by default), copied onto each check-in when it opens so a later change doesn't move the goalposts.

### Three steps

1. **Check-in.** Each player on the active roster checks in once, privately: they can volunteer themselves as co-captain or as next season's captain, suggest one teammate for either, or simply say things are good as they are. All three count as taking part. The captain's own check-in can say they're happy to hand over next season. A teammate who is suggested is asked, by the daily job, whether they'd like to stand, and can say no; a volunteer stands without being asked and can withdraw.
2. **Secret ballot**, only with enough support. When the check-in closes, the job counts who took part against the active roster at that moment. Below the quorum, nothing changes. At or above it, if at least one teammate other than the captain is standing for captain, a ballot opens for five days with those teammates and "keep the current captain" (left out if the captain said they'd hand over). Otherwise nothing changes. Co-captain volunteers aren't voted on: the captain is told privately who would like to help, and adds co-captains with the usual tools.
3. **Result.** When the ballot closes, it needs the quorum again, then a clear majority: more than half of the ballots cast. A tie, or no option over half, changes nothing. If the current captain is chosen, nothing changes. Whatever the result, the captain hears it privately first and the team three days later, so the wait itself never hints at which way it went. If a teammate is chosen, the captain uses those three days to choose: hand over now (a captaincy offer, which the teammate accepts, as in ADR 0042) or stay on for the rest of this season with the teammate as co-captain and captain-elect, who is offered the captaincy once the team's next season starts. With no choice after three days, the captain-elect path is taken, or a hand-over if the captain had said they'd hand over. Admins hear the outcome with the team.

The team only ever sees the outcome in words ("Jo S. will captain next season", "No changes this time"). Nobody sees counts, not even admins: on a small roster a count can give a vote away.

### Ballot secrecy

The threat model is everyone who uses the app or reads what it keeps: teammates, the captain, admins, owners and the operator, through any page, query, export, audit entry or log, and anyone reading the database tables, system columns included. It is **not** someone with database superuser access watching the write-ahead log, or restoring the database to the instant before and after each vote: any design that tallies votes as they arrive can be diffed that way, and the alternative (holding each ballot until close) keeps a voter-to-ballot link for longer.

Within that model:

- **Who took part and what they chose are stored apart.** `leadership_participation` (check-in, person, step) records only that a person checked in or voted, once each; it has no timestamp and no reference to anything they chose. Choices are counters with no person attached: `leadership_ballot_option.votes`, and the `nominated` flag on `leadership_candidate`.
- **Nothing ties a choice to a moment.** The candidate and option tables have no created or updated times. A suggestion doesn't message the teammate at once (the message's time would match the suggester's check-in); the daily job asks every newly suggested teammate in one batch, and they see the suggestion on their page only once asked.
- **Every choice touches every row.** A vote adds `1` to the chosen option and `0` to every other option of the check-in in one `UPDATE`; a check-in sets the flags on every candidate row of the team in one `UPDATE`, after creating any rows missing for people on the roster. So each row's `xmin` (the transaction that last wrote it) is the latest voter's for all of them alike, and says nothing about which option was chosen. A test checks this.
- **No log or audit entry names a choice.** Votes and check-ins write no audit row and no log line. The audit log records opening, pausing, resuming and closing a check-in, the outcome and the captain's choice, which the team sees anyway.
- **A person's own export** says which check-ins and ballots they took part in, never what they chose.
- **Choices are final.** Without a link there is nothing to edit, so the forms say so before they're sent.

### Roster changes, pauses and disputes

- Who may take part is checked when they act: the active roster at that moment. A player who joins mid-check-in can take part; a player who leaves can't any more, but what they already chose stays counted, since it can't be found again. The quorum is measured against the roster when each step closes.
- A suggested teammate or candidate who has left the team by the time the ballot opens is not on it. If the ballot's winner has left by the time it closes, nothing changes.
- An admin can pause a check-in when it is disputed. While paused, nobody can check in, answer or vote, and the job leaves it alone; resuming moves its deadline on by the time it was paused. An admin can also close it with no change, which the team sees as "closed by the league". Admins can't see or change a choice.
- Captains can always step down on their own, check-in or not, with the captaincy handoff.

## Alternatives considered

- **A vote row per voter with an encrypted or hashed voter id.** A hash of a small, known roster is reversible by trying every name, and encryption only moves the link to whoever holds the key.
- **Holding ballots until the close and tallying in a batch.** The ballots must be kept, with their voter, until then.
- **Letting any player start a check-in for their team.** It would read as a move against the captain, the drama this exists to avoid.
- **Showing the vote counts.** On a 12-person roster "7 to 5" tells people a lot about who voted how; the outcome is enough.
- **Building on captain polls.** Those polls are for captains to ask their team quick questions, with results the captain sees; this needs counts nobody sees and a vote nobody can trace, so it has its own tables.

## Consequences

- Four new tables (`leadership_check_in`, `leadership_candidate`, `leadership_ballot_option`, `leadership_participation`), one league setting and one daily job (`/api/jobs/leadership-check-ins`).
- A vote or check-in can't be changed or withdrawn after it is sent, and a vote stays counted if the voter leaves the team.
- A suggested teammate learns of it within a day, not at once.
- The captain-elect's takeover depends on the team being entered in the next season with both of them on its roster; if not, nothing happens and the captain can hand over as usual.
