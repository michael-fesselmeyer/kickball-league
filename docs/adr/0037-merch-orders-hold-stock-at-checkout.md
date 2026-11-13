# ADR 0037: Merch orders hold their stock from checkout, and photos live in Postgres

- Status: accepted
- Date: 2026-11-13

## Context

The league sells a few things besides registration: a league shirt, a hat, and replacement team jerseys for players who lost theirs or joined late. The product spec lists merch and replacement jersey orders (P3). Shirt tracking already knows each player's size and team; money already has Stripe Checkout, a signed webhook that alone marks a purchase paid, league credit taken when checkout starts, and the refund flow. Event tickets ([ADR 0027](0027-event-tickets-hold-their-spot.md)) already solved a close cousin: never selling more than there is while a checkout stays open for half an hour.

Some items are printed in a batch after an order deadline, so they have no stock limit; others come from a box of shirts the league already has, so each size can run out. Items need photos, and the product must cost nothing to run ([ADR 0021](0021-free-services-only.md)).

## Decision

**An order is one item in one size, in one checkout**, with a quantity of one to five. `merch_order` holds its status (`held` while the checkout is open, `paid`, `fulfilled`, `refunded`, or `released` when the checkout ended unpaid), the unit price paid (the member price for anyone registered in any season), and for a replacement jersey the team with its name and color as they were when ordered, so the printer's list doesn't change if the team does.

**Stock is counted, not decremented.** `merch_item_size.stock` is how many of a size the league has in all. What is left is the stock less the quantity of orders that are paid, fulfilled, or held with `held_until` still ahead. A refunded or released order simply stops counting, so there is no counter to put back and nothing to drift. An item made to order has no limit.

**Ordering locks the item row**, as buying a ticket locks the event row. Under the lock, checkouts whose hold ran out are released (their purchase is closed and its credit given back), what is left of the size is counted, and the order is created holding its stock. Two people ordering the last shirt at once queue on the lock, and the second sees it gone. The purchase starts through the existing `startPurchase` with no season and no promo code, so league credit applies exactly as at registration, and credit that covers the order settles it at once.

**The hold outlasts Checkout by an hour**, as tickets do: Checkout expires after 31 minutes and the stock stays held 60 minutes more, so a late `checkout.session.completed` still finds it. `checkout.session.expired`, a failed payment, or a buyer starting over releases it at once. A payment that arrives after its hold was released is honored, because the person paid; a size can then show as oversold by that order, and the admin sees it.

**Webhooks lock the item before the purchase row**, in the same order as a buyer, so an expiring checkout and a new order can't deadlock.

**Fulfilling and refunding.** An admin marks orders fulfilled one at a time or all at once; each buyer gets a non-urgent notice. A refund is always the whole order, through the refund flow: the card part is reserved as a `refund` row and sent to Stripe with that row's id as the idempotency key, and once Stripe accepts it the order ends, its stock counts as free again, the credit spent on it returns as a `released` ledger row, and the buyer is told. A full refund made in Stripe's dashboard does the same through `charge.refunded`. The receipt is urgent (`merch_receipt`); the ready and refund notices can wait (`merch_update`).

**The printer gets a CSV** of every paid order not yet fulfilled, one row per order by item, size and team, with the team color, written through the existing CSV helper and its formula-injection guard. Downloading it writes an audit row.

**Photos are stored in Postgres like the Instagram copies** ([ADR 0023](0023-instagram-photos-stored-in-postgres.md)): uploaded through a Server Action, checked (JPEG, PNG or WebP, up to 3 MB), shrunk by the same `compressPhoto` to one WebP at most 1000 px wide with its metadata dropped, and served from `/media/merch/[image]` through the image optimizer, only while the item is in the shop. An item has at most 4 photos, and all merch photos together at most 10 MB; an upload past either is refused with a message. Uploads lock the league's items, so two at once can't both squeeze under the cap. Server Actions take up to 4 MB so a photo straight from a phone fits, below Vercel's 4.5 MB request limit.

**Free services only.** Stripe has no monthly fee; its per-payment fee comes out of the merch money, and the admin form says so. No Stripe Tax, Billing or product catalog is used: the price is sent with each Checkout session. No print-on-demand service: the league prints with whoever it likes, from the CSV.

## Alternatives considered

- **Decrement stock when an order is placed and add it back on expiry or refund.** Every path that ends an order would have to remember to add it back, and a missed webhook would lose stock for good.
- **Stripe's product catalog and Payment Links.** Prices and stock would live in two places, and Payment Links can't apply league credit or a member price.
- **A print-on-demand service** that prints and ships each order. Each charges per item or needs a paid plan, and the league already has a local printer.
- **Vercel Blob for the photos.** Needs a store set up and another free limit to watch for at most 10 MB of photos; the photos sit behind one table and two routes, so they can move later.
- **A cart with several items per checkout.** More to hold, release and refund at once, for a shop of a handful of items where most people buy one thing.

## Consequences

- A size can sit held for up to an hour and a half after an abandoned checkout if Stripe's expired webhook never arrives; the next order of that item releases it.
- `startRefund` also takes a merch order as its scope, and a merch order's purchase has no season.
- Paid orders stay when a buyer deletes their account, as records of money paid, so the league can still hand them out or refund them; open checkouts are released.
