# ADR 0027: Event tickets hold their spot from checkout, and a paid ticket is an RSVP

- Status: accepted
- Date: 2026-11-13

## Context

Some league events cost money: a bowling night pays for lanes, a prom for the hall. The product spec lists paid event tickets (P3), and the permissions matrix lets anyone who can RSVP buy one. Events already have a capacity, a waitlist that moves up under a lock on the event row, and audiences that decide who can see an event. Money already has Stripe Checkout, a signed webhook that is the only thing that marks a purchase paid, league credit taken when checkout starts, and an admin refund flow. Tickets have to fit all of these and never sell more spots than the event has, while a checkout can stay open for half an hour and a webhook can arrive late or twice.

## Decision

**A ticket is a row that holds a spot, from offer or checkout to paid.** `event_ticket` has a status: `held` while a checkout is open, `offered` while the next person on the waitlist has a day to buy, `paid`, `refunded`, `released` (ran out unpaid) or `cancelled` (given up with a deleted account). Held and offered spots carry `held_until`; every count compares it with the current time, as waitlist offers and sub claims do ([ADR 0006](0006-sub-claims-hold-spots.md), [ADR 0022](0022-captain-guarantee-and-league-credit.md)), so a missed webhook or job never keeps a spot forever.

**A paid ticket is also a going RSVP.** When the purchase settles, the holder gets a `going` row in `event_rsvp`. Every count, attendee list, calendar feed and "you're going" note that reads RSVPs sees ticket holders with no change, and a spot taken is always going plus live holds and offers.

**Buying locks the event row**, like an RSVP. Under the lock: offers and holds whose time ran out are released (their checkout's purchase is closed and its credit given back), free spots go to the waitlist as offers, and only then is a free spot nobody is waiting for held for the buyer. The purchase is started with the existing `startPurchase`, so credit is applied the same way as at registration; credit or a free member price that covers the whole ticket settles it at once. A full event puts the buyer in line.

**A checkout holds its spot an hour longer than Stripe takes payment.** Checkout is created with `expires_at` 31 minutes out (Stripe's shortest is 30). The hold lasts another 60 minutes, so a `checkout.session.completed` delayed by Stripe still finds its spot. `checkout.session.expired` releases it at once. A payment that arrives after its hold was released is still honored, because the person paid.

**Webhooks take the event lock before the purchase row**, in the same order as a buyer, so an expiring checkout and a new buyer can't deadlock.

**A spot that opens on a ticketed event is offered, not given.** On a free event the next person moves up; on a ticketed one they get a day (or until the event ends) to buy it, and an email. Passing on the offer, or letting it run out, offers it to the next person.

**Refunds go through the existing refund flow.** An admin refunds a whole ticket: the card part is reserved as a `refund` row and sent to Stripe with that row as the idempotency key; once Stripe accepts, the ticket ends, its holder stops going, the credit spent on it comes back as a `released` ledger row, and the spot is offered to the waitlist. A full refund made in Stripe's dashboard does the same through `charge.refunded`. An event with paid tickets or open checkouts can't be called off, deleted or made free until its tickets are refunded.

**Free services only.** Stripe charges no monthly fee; its per-payment fee comes out of the ticket money. No Stripe Tax, Billing or other paid product is used. Check-in is a six-character code from an alphabet without 0, O, 1 and I, shown on the ticket and typed or read out at the door; no scanner service.

## Alternatives considered

- **Count only paid tickets against the capacity.** Two people could both reach Stripe for the last spot, and one would pay for a ticket that doesn't exist.
- **Hold the spot only until Stripe's expiry, with no grace.** A late `completed` webhook could then find the spot sold to someone else.
- **Give the freed spot straight to the next person on the waitlist**, as free events do. They would have a ticket they never paid for.
- **Refund every ticket automatically when an event is called off.** Many Stripe calls in one admin action, with partial failures to untangle; one refund at a time from the ticket list is clearer and each one is audited.
- **QR codes and a scanner at the door.** Needs a camera flow and nothing a short code can't do at a league event; it can come later on the same code.

## Consequences

- A person RSVP'd to a free event that later gets a price keeps their free spot.
- A spot can sit unused for up to an hour and a half after an abandoned checkout if Stripe's expired webhook never arrives, and an offer that runs out waits for the next buy, refund or expired checkout on that event before it passes on.
- `startRefund` now takes either a season or an event, and `purchase.season_id` is null for a ticket.
