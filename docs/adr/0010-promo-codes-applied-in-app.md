# ADR 0010: Apply promo codes in the app, and refund through Stripe's webhook

- Status: accepted
- Date: 2026-11-12

## Context

The pricing milestone needs promo codes (a percentage or an amount off, for one season, with an optional limit and last day) and full or partial refunds. The product spec first named Stripe promotion codes. Stripe Checkout can take a promotion code itself, either typed on its hosted page or attached to the session, but then Stripe decides the discount and the app only learns it from the webhook. The league also takes cash and Venmo, and the roster board, the payment reminders and the payments download all read the app's own `purchase` rows.

For refunds, the app can ask Stripe to refund a payment, but Stripe confirms it later with a `charge.refunded` event, and an admin can also refund straight from Stripe's dashboard.

## Decision

**The app owns promo codes.** A `promo_code` row belongs to a season. When a person pays, they may type a code; checkout locks the code's row, counts its uses, works out the discount with the pure functions in `src/domain/registration/promo.ts`, and writes `discount_cents` and `promo_code_id` on the purchase. Stripe Checkout is sent the line items at the discounted price, so it never sees the code. A code that covers the whole price settles the purchase without Stripe.

**Stripe's webhook owns the refunded total.** An admin's refund is reserved in a `refund` row under a lock on the payment, sent to Stripe with that row's id as the idempotency key, and kept with Stripe's refund id. The payment's `refunded_cents` moves only when `charge.refunded` arrives, and is set to Stripe's running total, never lowered. Refunds made in Stripe's dashboard therefore count as well. Cash and Venmo refunds have no Stripe side, so they count at once.

## Alternatives considered

- **Stripe promotion codes.** Each code would need a coupon and a promotion code created in Stripe, kept in step with the app when an admin edits or turns one off, and a second path for cash payments. Checking a code before sending someone to Stripe, and showing uses on the admin screen, would still need the app's own records.
- **Mark a Stripe refund done as soon as the API call returns.** Simpler, but it would miss dashboard refunds and could disagree with Stripe if a refund later fails. The webhook is already the only thing that marks money paid; refunds follow the same rule.
- **Refund through a background job.** It would survive a crash between reserving and calling Stripe, but refunds are rare, an admin is watching, and a failed call gives the reservation back at once.

## Consequences

- Stripe's receipts show the discounted price and not the code's name.
- A purchase's discount is fixed when checkout starts. Turning a code off later does not change purchases that used it.
- An open checkout holds one use of a limited code until it is paid, expires or fails, so a code with one use left can be briefly unavailable while someone is on Stripe's page.
- If the app stops after Stripe accepts a refund but before it stores Stripe's id, the `refund` row stays without an id; the webhook still records the money, and the board shows the amount as refunded.
