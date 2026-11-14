# ADR 0041: Merge duplicate accounts by rule, in one transaction, and keep the old address as an alias

- Status: accepted
- Date: 2026-11-14

## Context

Players sign up twice: once by email link with a work address, once with Google and a personal one, or a captain's invite goes to an old address. Their registrations, payments, league credit, waiver, RSVPs, votes and photos end up split across two accounts. An admin needs to fold one into the other without losing money or history, and the old address should not quietly create a third account the next time it is used.

About a hundred columns in the schema point at a person, and new features keep adding more. Several have a unique key that includes the person (one RSVP per game, one vote per poll, one registration per season, one signature per waiver and season), so a blind update would fail or break a rule.

## Decision

**Every person column has a written rule.** `src/domain/account-merge/rules.ts` lists each `table.column` that references `user.id` and says how it moves: a plain move; a move that first settles clashes on the column's unique key by dropping the merged-away row, closing it, or leaving it behind as history; a named special case; or skip. A unit test reads the Drizzle schema and fails when a column that references a person has no rule, so a new table cannot be forgotten.

**Clashes have fixed, visible answers.** The kept account's RSVP, vote, setting and sponsor membership win. The earliest waiver signature stays and the registration points at it. Of two registrations for the same season, an empty one (no payment, team spot or referral) gives way; if both hold something, the merge is refused until an admin sorts it out. A vote one account cast for the other is removed, since nobody may vote for themselves. Uncredited referrals that would point at one person twice are removed; credited ones stay with the merged-away account as history. The kept profile keeps its values and fills empty fields from the other. The preview shows every clash and its answer before anything changes.

**Refuse what would lose something.** A merge is refused when it would merge away the admin doing it, a higher role than the kept account has, an account already merged, two registrations that both hold money or a team spot, or two shares of one rain-out rebate.

**One transaction, both accounts locked.** The merge locks both user rows, re-checks the blockers, applies every rule, renames the merged-away account to "Merged account" with an address that cannot receive mail, ends its sessions, and writes an `account_merge` record and an `account.merge` audit row. Either all of it happens or none.

**The old address becomes an alias.** `account_merge.merged_email` maps the old address to the kept account. A sign-in link asked for it is sent to the kept account's address, admin lookups by it find the kept account, open invitations sent to it are re-addressed, and creating a new account with it is refused. Passkeys and Google sign-ins move with the person, so they sign in to the kept account.

## Alternatives considered

- **Delete the merged-away user row.** Foreign keys that are `set null` would erase who did what, and `restrict` ones would block the delete. Keeping the row, renamed, keeps history intact.
- **Discover unique keys at run time from the database catalog.** Generic, but the right answer to a clash is a product decision (which vote counts, which signature is the legal one), not something the catalog can say.
- **Let the person merge their own accounts.** They would need to prove they own both, which means signing in to both at once. Admin-only is simpler and rare enough.

## Consequences

- Adding a table with a person column means adding its rule; the test makes that impossible to miss.
- Rows left as history (a second sub claim, giveaway entry or same-day bar check-in) stay with the merged-away account and do not count for the kept one.
- A merge cannot be undone automatically. The `account_merge` summary and the audit row record what moved.
- Someone who only has the old inbox can no longer sign in by email link; the link goes to the kept account's address.
