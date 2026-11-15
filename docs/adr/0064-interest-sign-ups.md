# ADR 0064: Interest sign-ups with unverified addresses

- Status: accepted
- Date: 2026-11-15

## Context

Before the league books a permit for a second night, another park or a different format, it wants to know whether enough players would come. Asking in a chat group gives counts nobody can check and loses the people who are not in the group. The league also wants to tell those who showed interest when it goes ahead.

The people answering often have no account, and the form is public. The site is free to run ([ADR 0021](0021-free-services-only.md)), so it cannot send a confirmation email for every answer.

## Decision

**A public form collects answers with an email address and no verification. Totals are computed when read, and one email goes out when an option goes ahead.**

- An admin opens one form at a time per league, with options: a night, a format, a park, or a mix. The target is a number of teams (default 8) and a team size (default 12). Neither is copied into the totals, so editing them after answers arrive changes every "enough to run" marker at once.
- Every question allows "Not sure". An option is No, Not sure or Yes; friends is a number or Not sure. Only Yes answers, with their friends, count toward the marker. Not-sure answers are shown beside it, so an admin sees how close the option could get.
- An address answers once per form. Answering again replaces the earlier answer, and the reply is the same either way, so the form never reveals whether an address has answered.
- When an admin decides an option goes ahead, one non-urgent email goes to every address that said Yes or Not sure for it. It waits out quiet hours and counts against the email allowance like other league news. Someone who picks the option after it went ahead gets the same email when they answer. A dedupe key per answer and option keeps it to one.
- Addresses are cleared six months after the form closes. The totals stay. An admin can delete one address's answer on request.
- The page is static HTML read inside `use cache`, expired by the admin's actions, with no cookie, header or query-string read.

## Alternatives considered

- **Confirm each address by email first.** It stops someone entering another person's address, but costs an email per answer against a free allowance a flood could use up, and loses answers from people who never click.
- **Keep the first answer and refuse the rest.** It stops one address changing another's answer, but it blocks people correcting a mistake and tells a visitor that an address has answered.
- **Store the target on each option.** It would make an edit rewrite every option and let two options of one form disagree.
- **Count Not-sure answers as half a player.** The marker would then be a guess that nobody can explain. Showing both numbers is clearer.

## Consequences

- Anyone can enter someone else's address, which can send that person one email about a league going ahead. The email says why it was sent and to ignore it if it was not them, and it goes once per person and option. Rate limits per address, per network and overall, and a honeypot, keep a flood small. Counts are the league's own signal, not a vote, and the admin sees them as unverified.
- The person who answered again overwrites an earlier answer from the same address, whoever typed it. The cost of that is small, and so is the harm.
- An option with answers can't be removed, so the totals and the promise made to those who picked it are never lost.
