# ADR 0081: Looking for a change, hidden from your own team, with a double opt-in

- Status: accepted
- Date: 2026-11-15

## Context

Some players want a different team next season: a different night, a different vibe, friends elsewhere. Asking around is awkward. Word reaches their captain, some captains feel they own their players, and a player who would rather not have that conversation sometimes leaves the league instead. The league loses a player over what should be an easy change.

The feature only works if a player can trust it. One leak, a captain who learns that a player wants out, does the damage the feature is meant to prevent. So privacy from the player's current team decides every other choice. It has to hold in every path: pages, queries, exports, messages, the audit log and the counts a captain sees.

## Decision

**A private flag, one per person per league.** `move_interest` holds who may see it (admins, recruiting captains, or both) and an optional note of up to 140 characters, such as a preferred night. The app never asks for a reason, and the words everywhere are neutral: "looking for a change", "open to a new team".

**Never visible to any team the player has played on.** A team "the player has played on" is any lasting team they have had a roster spot on, in any season and any state (invited, active or removed). That is stricter than "this season's team": it also covers last season's team between seasons, a player on two teams in two seasons at once, and a team they left. Captains, co-captains and teammates of those teams never count, read or hear of it. Nothing public shows it. A team's "not on my team" list ([ADR 0036](0036-not-on-my-team-list.md)) also keeps a person out of that team's count and invites.

**Recruiting captains see a count, not names (double opt-in).** A captain or co-captain of a team entered in a league season that is a draft or open for registration, before its close, sees how many players they may invite and haven't. One button invites all of them, with one optional pitch, so the captain can't target or rule out a person by trial. Each invited player gets an email and sees the invite on their own page. A "yes" shows that team's captains the player's name, email and note, and emails them. A "no", or no answer, reads to the team exactly like waiting. A player sees a heads-up when one of the inviting team's captains plays with them this season, because a yes would then tell a current teammate.

**Admins see it only when the player chose so.** They get the name, note, current teams and which teams the player said yes to, never a "no". The free-agent matcher ([ADR 0012](0012-free-agent-matching.md)) treats it as a preference: it suggests a different team when one has room, and the player's last team only as a fallback.

**Nothing goes in the audit log.** Admins read the log, so an entry would show a "captains only" player to admins. The player's own data export holds their flag and every invite with its answer; a captain's export holds the pitches they sent and to how many players, never to whom or who answered.

**It clears itself.** A flag counts until the first registration close of a league season after it was set, which is next season's; a season with no closing date closes as it starts. Every read checks this, so it holds between runs of the daily retention job, which then deletes the row and its invites. Withdrawing deletes them at once and tells nobody. Private events ([ADR 0049](0049-private-events-are-private-seasons.md)) neither count as next season nor recruit.

## Alternatives considered

- **Hide it from the current season's roster only.** Simpler, but between seasons a player has no "current" roster, so last season's captain, often the same captain next season, would see the flag.
- **Show recruiting captains a list of anonymous profiles (night, note).** More useful for matching, but a note and a night are often enough to identify someone in a league this size. The note goes only to admins and, after a yes, to that team.
- **Let captains invite one anonymous player at a time.** Lets a captain probe who is behind each slot by watching who answers; inviting everyone at once gives nothing away.
- **Tell the captain about a "no".** Honest, but a "no" is information about a person the team was never meant to learn exists.
- **Store a target season on the flag.** Explicit, but next season often doesn't exist yet when a player decides, and the flag would need moving when it is created. Clearing at the next registration close needs no target.
- **Record changes in the audit log for support.** Useful when something looks wrong, but it would show every flag to every admin, whatever the player chose.

## Consequences

- A team never sees a returning player of its own in the count, even one who left years ago. A player who wants to go back to an old team asks them directly.
- The count can be small. A captain who sees "1 player" learns that someone is open, not who; the name still needs a yes.
- A player who narrows the audience to admins hides an earlier "yes" from that team's page again, though the team may already have emailed them.
- Two new non-urgent messages, `move_invite` and `move_accepted`, under the existing "Captain and co-captains" email topic.
- Several more queries on the team page for captains, and only while their season is recruiting.
