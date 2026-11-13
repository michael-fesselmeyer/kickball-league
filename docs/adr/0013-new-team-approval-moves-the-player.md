# ADR 0013: Approving a new team moves the player and keeps their payment

- Status: accepted
- Date: 2026-11-12

## Context

A player can ask the league to start a new team ([information-architecture.md](../information-architecture.md), section 2.7). The person asking is often already in the season: playing on a friend's team, or in the free-agent pool, and sometimes already paid. Approval has to turn that person into the captain of a new team without breaking the roster rules (one active team per registration, one captain per team) or the money: a captain who pays in full owes the whole team fee, a split team's captain owes one share, and a player whose captain paid the team fee in full owes nothing of their own.

## Decision

**Approval moves the player.** The requester's existing registration is reused, and a free agent becomes a team member. Any active spot on another team is ended (`removed`, with `ended_at`), and that team's captain is emailed. The new captain spot is added in the same transaction, after the old one ends, so the one-active-team index never sees two. The request records `left_team_season_id`, the team that lost the player. A captain of another team cannot ask: they must hand that team over first, so no team is ever left without a captain.

**A payment the player made stays theirs.** If the requester has a paid purchase item for their own registration, they stay paid and the new team splits its fee, so their payment counts as their share; the request form offers only "split" in that case. If they were paid up only because their old captain paid the team fee in full, they go back to `pending_payment` and owe for the new team. Nothing is refunded or moved automatically.

**The price is fixed on the day they asked.** The share is computed with the request's `created_at`, so a request made in the early-bird window keeps the discount even when an admin approves it later.

**Approval checks again.** The request row is locked, and the team limit, the team name and the captain rule are checked again at approval, because they can change while a request waits.

## Alternatives considered

- **Only unregistered players may ask.** Simplest, since approval would just register a team, but the product spec's main case is a rostered player starting their own team, and the direct registration flow already covers someone who is not registered.
- **Refund or credit the old payment automatically.** Correct to the cent, but refunds and league credit belong to the refunds work, need owner policy, and would make approval move money without anyone deciding to. Keeping the payment as a split share is right in the common case (shares are close in size), and an admin can still refund or credit a difference by hand.
- **Let the requester stay on their old team until the new one is confirmed.** It would need two active roster spots at once, which the schema forbids on purpose, and the old captain would not know whether to count them.

## Consequences

- A requester who paid a larger free-agent fee or share than the new team's share is not refunded the difference automatically; an admin sees "already paid" on the request and can settle it.
- An old team on split pay loses that player's share; its captain is told and can invite someone else.
- The decision on each request is in the audit log (`team.request_new`, `team.withdraw_request`, `team.approve_new`, `team.decline_new`).
