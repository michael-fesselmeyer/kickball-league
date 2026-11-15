# ADR 0067: Refunds Stripe reports before their payment

- Status: accepted
- Date: 2026-11-15

## Context

The webhook applies `charge.refunded` to the `payment` row that holds the charge's PaymentIntent. Stripe does not deliver events in order and retries a failed delivery for up to three days, so a refund event can arrive before the `checkout.session.completed` (or `payment_intent.succeeded`) that records the payment: for example when the endpoint was down while the payment completed and an admin refunded part of it in Stripe's dashboard. The refund event found no payment, was recorded as processed and ignored, and the payment recorded later kept `refunded_cents = 0`. The purchase stayed `paid`, and the books and the player's history showed the full amount. A replay changed nothing, because the event id was already recorded.

Two events about one PaymentIntent can also run at the same time. Under read committed, a refund that runs beside its completion sees no payment yet, and the completion does not see the refund's uncommitted event row, so even a fix that looks for earlier refunds could lose one.

## Decision

**The stored refund event remembers what it needs, and recording a payment applies it.** `webhook_event.payload` already keeps the event's id, type and object id, never the object. For `charge.refunded` it now also keeps the charge's PaymentIntent id and Stripe's running `amount_refunded`; neither names the buyer. After a Stripe payment is recorded, from a Checkout session or the guarantee's deadline charge, the handler looks up the highest refunded total stored for that intent and applies it the same way a refund that arrives later is applied: capped at the payment's amount, never lowering what is there, then the purchase's status, a fully refunded ticket and a fully refunded merch order follow.

**One advisory lock per PaymentIntent.** Every handler that records a payment or applies a refund takes `pg_advisory_xact_lock(hashtext('stripe_intent:<id>'))` first, before any ticket, merch or purchase lock, so the two events for one intent run one after the other and the second always sees what the first committed. Different intents do not wait on each other.

A refund of a charge this app never made (the Stripe account may be used for other things) is stored and ignored, as before, and is never applied to anything.

## Alternatives considered

- **Return 500 when no payment holds the intent, so Stripe retries.** Simple, but a refund of a charge that is not the app's would be retried for three days and alert as a failing webhook, and a payment that arrives after the last retry still loses the refund.
- **A table of the latest refunded total per PaymentIntent.** The clearest model, and indexed, but it needs a migration and duplicates what the event log already holds.
- **Read the charge from Stripe when the payment arrives**, as the setup-mode completion looks up the card. Stripe is the source of truth, but every completion would wait on one more API call, the database tests could not exercise it without mocking Stripe, and a refund event running beside the completion would still need the lock.

## Consequences

- No migration. Refund events stored before this change lack the two fields and are not found; those refunds were already handled or already lost. A later refund of the same charge carries Stripe's whole running total, so it puts such a payment right.
- Recording a Stripe payment reads `webhook_event` by a JSON field with no index. The table holds one row per webhook, a few thousand a season for one league; if it grows enough for that read to matter, an expression index on `payload->>'paymentIntent'` for `charge.refunded` rows is the next step.
- Events for one PaymentIntent are serialized. Stripe sends only a handful per intent, so nothing waits in practice.
