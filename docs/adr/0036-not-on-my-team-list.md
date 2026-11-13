# ADR 0036: A private "not on my team" list that works quietly and only for that team

- Status: accepted
- Date: 2026-11-13

## Context

Captains sometimes don't want a particular person on their team: a past clash, someone who made a teammate uncomfortable, or just a bad fit. Without a tool, they ignore invite requests and hope the league never places that person with them, which goes wrong when the free-agent matcher or the sub finder sends the person their way, and a refusal made in public turns into drama for everyone.

Two things must not happen. The list must not become a way to punish someone across the league: the person still plays, joins other teams, RSVPs and subs. Real safety problems already have their own path, incident reports and suspensions ([ADR 0026](0026-discipline-counted-not-stored.md)), which admins review. And the person must not be able to tell they are on a list, because knowing invites the conflict the list is meant to avoid.

## Decision

**One row keeps one person off one team.** `team_keep_off` hangs off the lasting `team`, not the season's entry, so a captain doesn't have to list someone again every season. A captain or co-captain manages their own team's list from the team page; admins and owners manage any team's from the admin screen. A captain adds a league member by their email address, which names exactly one account, with an optional private reason of up to 300 characters. A current teammate can't be added; the league moves them first.

**It changes three things, and only for that team.**

- The team's invite link reads as expired for them: `inviteByToken` returns the `expired` state and `acceptInvite` the `expired` error, so the page and the join attempt are word for word what anyone sees for an expired link (`inviteStateFor` in `src/domain/keep-off/keep-off.ts`).
- The matcher never suggests the team for them or a friend group they are in. An admin placing them by hand is stopped with a warning naming the team and the person, and can place them anyway; the override writes its own `keep_off.override` audit row next to the placement.
- They are never told about the team's sub requests, never see them and cannot claim them (a claim gets the same "not found" as a request that doesn't exist). Requests from the other team in the same game reach them as usual.

Nothing else reads the list. No email, push or in-app notice is ever sent about it.

**Admins watch for misuse.** The admin screen shows every list with reasons and who added each entry, points out any team listing 5 or more people and anyone on more than one team's list, and lets an admin take an entry off. A person on several lists may be a safety problem that belongs in an incident report; a long list may be a captain misusing it.

**The audit log never holds the reason.** Adds and removes record the team and the person; the reason lives only on the row, so deleting the row, or either account, removes it.

**A person's own export leaves out entries about them, by default.** Whether a data request should include what others wrote about you is a league policy question with no single right answer, so it is a setting, `league.export_keep_off_entries`, that only owners can change, from the admin screen; the change is audited. Entries a captain added are always in that captain's own export, as data they created. Deleting either the listed person's or the adding captain's account deletes the entries.

## Alternatives considered

- **Tell the person, or show a "this team isn't taking you" message.** Honest, but it starts the very conversation the captain wanted to avoid, and the person learns exactly which team said no.
- **A league-wide block.** Stronger, but it lets one captain shut someone out of the whole league with no review. Suspensions already do that, with an admin deciding.
- **Key the list on the season's entry (`team_season`).** Simpler joins, but captains would rebuild the list every season and a returning team would lose it silently.
- **Copy the reason into the audit log.** Complete history, but the reason would outlive a deleted account, and every admin reading the log would see it out of context.
- **Always include entries about a person in their export.** Most transparent, and arguably what a data-access request asks for. It also tells the person which team listed them and why, which undoes the quiet the feature exists for. Leaving them out is also defensible: the entry is the team's note about who it plays with, and it never affects the person's standing in the league. The league decides; the default keeps the list quiet.

## Consequences

- One extra query on the invite page, the matcher input, the sub-request lists and placements, each by index (`team_keep_off_user_idx`, and the `(team_id, user_id)` unique index).
- A listed person who already holds a claim on the team's sub request (from before the listing) still sees that request, so their game isn't taken away without a word; they can't make a new claim.
- If owners turn the export setting on, a person's export shows the team, date and reason of entries about them, not who added them.
- A friend group with one listed person is not suggested for that team, even if the rest would fit.
- If the league's privacy policy or local law later decides the question, the setting can be fixed in place without a migration.
