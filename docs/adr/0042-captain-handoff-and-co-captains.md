# ADR 0042: Hand the captaincy over by offer and acceptance, with fixed co-captain tools

- Status: accepted
- Date: 2026-11-14

## Context

A team's captain is a roster membership with `role = captain`, one per team season (an index enforces it), and the schema already had `co_captain`. Most game-day rules already treated co-captains as captains, but nobody could change either role without an admin editing the roster. Captains move away, get busy or want help mid-season, and account deletion is refused while someone captains a season that isn't over, which left them stuck.

Two questions needed answers: how the captaincy changes hands safely, and what a co-captain may do.

## Decision

**The captaincy moves by offer and acceptance.** The captain, or an admin, offers it to a teammate on the active roster (`captain_handoff`). The captain keeps the role until the teammate accepts on their team page; then, in one transaction that locks the team season, the old captain becomes a co-captain and the teammate the captain. Keeping the old captain on as a co-captain means nobody loses the team's tools halfway through a season; the new captain can make them a player. A declined offer changes nothing. One offer waits at a time per team; a new offer cancels the last and a withdrawal is quiet. An offer whose captain has changed by other means, or whose teammate has left, is closed when answered. Deleting either account cancels a waiting offer.

**Money stays with whoever captains when it is paid.** On a full-pay team the captain pays the team fee, so the captaincy doesn't change hands while a team-fee checkout is open; otherwise both people could end up paying. After a handoff the new captain is responsible for whatever is still unpaid; the offer, by email and on the team page, says the captain runs payments before they accept. A guarantee card a captain saved stays theirs; captains and co-captains can both save one, as before.

**Co-captains have a fixed set of tools.** They set kicking orders, ask for and answer subs, enter and confirm scores, see who has signed and paid, record cash payments, download the roster and keep the team's private list: every rule that already used "captain or co-captain" in `src/domain/authz/permissions.ts`. They can't hand the team over, change co-captains, change the captain's role or remove the captain (`captaincy.manage` is the captain and admins only). A co-captain may step down on their own (`captaincy.respond`). Paying the team fee and withdrawing the team stay with the captain, as before.

**People are told, and it is audited.** The teammate offered the captaincy gets a `captain_handoff` message (urgent: it waits on their answer). The answer to the captain, and a teammate made a co-captain or a player again, are `team_role` messages (non-urgent). Both use a new `team_roles` topic, on by default and offered on the settings page. Every offer, answer, withdrawal and role change writes an audit row described in plain words.

## Alternatives considered

- **Let the captain hand the team over at once.** Simpler, but it can make someone captain, and responsible for the team fee, without asking them.
- **Per-team co-captain permissions chosen by the captain.** The data model once planned this. It adds a settings screen and a permission per team, and every check becomes a lookup; one fixed set covers what captains asked for and keeps the rules readable. It can be added later without a migration of roles.
- **Make the old captain a player after a handoff.** Cleaner roles, but it takes the team's tools away from the person who has been running it, often in the middle of a week.
- **Admins move the captaincy without acceptance.** Admins can still edit rosters directly for exceptional cases; the screens they use here make the same offer a captain makes, so a person is never made captain without saying yes.

## Consequences

- One small table and one message topic (`team_roles`), added in the same migration.
- The account-deletion blocker for captains now has a way out without an admin.
- A team-fee checkout that is left open blocks a handoff until it is paid or expires.
- Co-captains' rights are the same on every team; a team wanting less has to choose its co-captains accordingly.
