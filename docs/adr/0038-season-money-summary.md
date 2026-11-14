# ADR 0038: The season money summary shows category totals, published by an owner

- Status: accepted
- Date: 2026-11-13

## Context

Members asked where their fees go (product-spec.md, section 9, "More transparency, without oversharing"). The owners' books (ADR 0034) already know the season's money in and its expenses by category. Publishing them must not share anything the privacy rules in data-model.md, section 4 keep private: no person's amount, birth date or contact details.

Totals can point at a person even with no name on them. If one referee worked every game, "Refs: $1,200" is that referee's pay. In a season with three players, "Collected: $255" says what each of them paid. And numbers that change on their own after an owner looked at them are not what the owner agreed to publish.

## Decision

**A season's money summary is off until an owner publishes it, shows category totals and fee shares only, and is a copy of exactly what the owner previewed.**

- **Off by default.** Nothing is public until an owner (or the platform operator) presses Publish on the preview. Taking it down deletes it. Both are audited. Admins can't see the preview or publish.
- **Totals only.** The summary holds the money collected (after refunds), the money spent by expense category with each category's share, what is not spent yet, and how each of the season's fees divides across the same lines. It never holds a name, a count of people, a note, a date of a single payment or any one person's amount. Income is one total: its parts (registrations, tickets, cash, refunds) stay on the owners' dashboard, since a single refund or cash payment could be one person's.
- **Fold into Other.** The owner can show any category inside "Other" before publishing, for a total that would point at one person.
- **A floor of ten members.** A season with fewer than ten members can't be published, so the money collected never stands for a handful of people's payments.
- **A copy, not a live view.** Publishing works the numbers out on the server from the live books (never from anything the form sends) and saves them in `money_summary.summary`. The public page shows that copy, so it matches the preview, and a later expense changes nothing until an owner publishes again.
- **Static.** `/seasons/[season]/money` is static HTML under the season's tag, like the standings. Publishing and taking down call `refreshSeasonPages`, which expires the tag and the route by path (ADR 0018). It is in the sitemap and in Lighthouse CI.

## Alternatives considered

- **A live public view of the books.** Always current, but it could change in ways no owner looked at, such as one big refund showing up as a drop in the money collected. Rejected.
- **Automatic suppression of small categories.** A rule like "hide any category with one expense" would hide shirts bought in one order while still showing one referee's pay entered as three expenses. The owner knows who was paid; the fold choice is theirs, with the preview in front of them.
- **Per-team or per-player breakdowns.** Out by design: they are exactly the amounts the privacy rules keep private.

## Consequences

- The published numbers can fall behind the books. The owner summary page says when it was published and that it keeps those numbers until published again.
- The floor of ten members is a constant (`MIN_MEMBERS_TO_PUBLISH`); a league that wants a different one changes it in code.
- Shares are of the money collected, with "Not spent yet" as its own line; when spending ran over the money collected, shares are of what was spent and the page says so.
