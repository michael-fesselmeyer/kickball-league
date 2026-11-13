# ADR 0022: Charge the captain guarantee off-session, and hold league credit when checkout starts

- Status: accepted
- Date: 2026-11-13

## Context

Roadmap item 13 adds money that moves without a person at a checkout page. A captain of a split-pay team can save a card that pays whatever the team still owes at the payment deadline (open question 14 assumes a 72-hour warning first). Players hold league credit from rain-out rebates, referrals and goodwill, and it should come off their next fee. Both touch rules the app already has: only Stripe's webhook marks money paid, every job is safe to run twice, and the outbox sends notices in the same transaction as the change.

## Decision

**The card is saved by Stripe, not by us.** The captain goes through Stripe Checkout in setup mode with a Stripe customer of their own. The webhook (`checkout.session.completed` with `mode: setup`) looks up the SetupIntent and its card, then stores Stripe's ids, the brand and the last four digits in `saved_payment_method`. One live card per team; saving another retires the first.

**The deadline charge is an off-session PaymentIntent that only the webhook settles.** A daily job works out each team's balance from its purchases. About 72 hours before the deadline it emails the captain the amount and the charge time. At the deadline, and never sooner than 72 hours after that email, it creates a `balance` purchase in the database, commits, then asks Stripe for an off-session PaymentIntent with the purchase id as the idempotency key. `payment_intent.succeeded` marks the purchase paid and confirms the team; `payment_intent.payment_failed`, or a decline returned at once, fails it and tells the captain. A guarantee is charged at most once and is not retried on its own.

**Credit is spent when checkout starts and given back if it does not finish.** `credit_entry` is append-only. Checkout locks the person's user row, sums their ledger, applies credit after any promo code (never leaving a charge under Stripe's 50-cent minimum) and writes a negative `spent` row tied to the purchase. When that purchase expires or fails, a matching `released` row returns the credit. A unique index on (purchase, reason) makes each happen once.

**Waitlist offers expire by their own clock.** An offer holds a spot until `offer_expires_at`; every query compares that with the current time, like sub requests ([ADR 0006](0006-sub-claims-hold-spots.md)). The job only marks old offers expired and sends the next ones, so a missed run delays an offer but never lets two people hold one spot. Registering a team takes a lock on the season row while it counts spots, so nobody jumps the line.

## Alternatives considered

- **Charge the card in Checkout at the deadline with the captain present.** That is just "pay the balance", which the team page also offers; the point of the guarantee is that nobody has to remember.
- **Mark the deadline charge paid from the API response.** Off-session payments can need authentication or settle later, and stripe-mock does not return a succeeded intent. Keeping the webhook as the one source of "paid" matches checkout and refunds.
- **Write the credit row only when the payment succeeds.** Two checkouts started at once could then both use the same balance. Holding it at the start and releasing it is simpler than reconciling later.
- **A stored balance column for credit.** Faster to read, but it can drift from the history; summing a person's rows is cheap at league scale and the ledger is its own audit trail.
- **Hourly offer expiry by a job alone.** Vercel's Hobby plan runs jobs daily; an offer that outlived its time would block the line for up to a day.

## Consequences

- Stripe's customer object exists for every captain who saves a card; the app keeps its id on the profile.
- A declined deadline charge leaves the team unconfirmed until the captain pays the balance or saves another card.
- Credit shown on the account page can dip while someone is on Stripe's checkout page and come back if they abandon it.
- A rebate goes to whoever paid toward the team, in proportion to what they paid; refunds already sent are taken off first.
- Refund-to-card rebates are not automated; an admin refunds individual payments from the registrations screen when the league prefers that.
