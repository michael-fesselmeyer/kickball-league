# ADR 0082: Payers cover processing fees with a lower price for free methods

- Status: accepted
- Date: 2026-11-15

> **Confirm the legal side before turning this on.** This ADR records what the card networks, Stripe and New York law said when it was written, as read from public sources. It is not legal advice. The setting ships off, and the league should confirm with its own adviser, and with Stripe, that the program below is allowed for it before an admin switches it on.

## Context

Card fees on team registrations are one of the league's larger costs. Stripe takes 2.9% + 30¢ of every domestic card, Apple Pay and Google Pay payment, so a $750 team fee costs the league about $22. Cash and recorded Venmo payments already exist and cost nothing. The rule the league wants: whoever pays with a method that costs the league a fee covers that fee, so the league nets its price, and the free methods (cash, Zelle and check) stay free and are always offered.

Passing a card fee on is regulated. What we found, as of November 2026:

**Card networks.**
- Visa caps a credit card surcharge at the lower of 3% and the merchant's actual cost of acceptance, since April 2023. Mastercard caps it at 4%, and also at the merchant's cost.
- Debit cards and prepaid cards may not be surcharged, even when they run on the Visa or Mastercard network (the Durbin amendment and the networks' rules). A surcharge program therefore has to know a card's funding type before it charges.
- Visa requires the merchant to notify its acquirer at least 30 days before it starts surcharging. Mastercard's advance registration now applies only in Canada, but acquirers may still ask for notice.
- A surcharge must be disclosed before the payer commits (at the point of entry and the point of sale), shown as its own line on the receipt, and refunded in proportion on a partial refund and in full on a full refund.
- None of these limits apply to a discount for paying another way. Merchants may offer a lower price for cash, check, debit or any other method (federal law since the Durbin amendment, and the networks' rules), as long as the regular price is the card price and the discount is clearly offered.

**New York.** General Business Law § 518, as amended from February 11, 2024, allows a credit card surcharge but caps it at what the card company charges the seller for the transaction, and requires the seller to post clearly the total price for paying by credit card, surcharge included, before payment. It allows two-tier pricing (a card price and a lower cash price) as long as the card price is posted. The law covers credit cards only. Violations carry civil penalties.

**Stripe.**
- Stripe's surcharge support in Checkout ("automatic surcharge") is a private preview, available only in the US, only for Checkout embedded with the Payment Element (`ui_mode: elements`), not hosted Checkout, and only with a third-party surcharge provider installed from the Stripe App Marketplace. Its price is set by that provider. The PaymentIntent-level surcharge (`amount_details.surcharge`) is a public preview on a preview API version, and supports credit cards only.
- Stripe says the business is fully responsible for surcharge compliance, fines and penalties.
- Stripe's US prices: 2.9% + 30¢ for domestic cards and wallets (more for international or manually entered cards), and 0.8% capped at $5 for ACH Direct Debit (bank transfers), with a fee for a failed or disputed bank payment.
- Venmo charges a business profile 1.9% + 10¢ per payment; a personal profile receiving money from friends pays nothing.

## Decision

**A lower price for free methods (two-tier pricing), not a card surcharge.** When the setting is on, every place a player or captain pays a season fee (registration, a split share, a team's balance) shows the total for each method before they commit:

| Method | Total |
|---|---|
| Cash, Zelle or check | the league's price |
| Bank transfer (Stripe ACH), when offered | price + the bank-transfer fee |
| Venmo, when the league uses a business profile | price + Venmo's fee |
| Card, Apple Pay or Google Pay | price + the card fee: the **card price** |

The card price is shown first and labelled as the card price, with the fee as its own line, and the free methods are described as costing less. That is the two-tier pricing New York's law allows, and a discount for paying another way, which no card network caps or limits by card type. Debit and prepaid cards pay the card price, which is allowed for a discount and would not be for a surcharge. This works in the hosted Checkout the app already uses, with no preview API and no paid provider.

**The fee never exceeds what the processor charges.** The fee for a net amount *N* is the largest gross *G* whose fee to the payer, *G − N*, is no more than the processor's own fee on *G* (the percentage rounded down, plus the fixed part). The league nets *N*, or a cent less when rounding allows no exact answer: the rule about not charging more than cost wins over the league's last cent. The rates are an admin setting with Stripe's and Venmo's published US rates as defaults, so a league with a lower negotiated rate sets it and never passes on more than its real cost. International cards cost more and the fee does not charge for that; the league absorbs the difference.

**Fees follow the amount actually charged.** The fee is worked out on what is left after a promo code and league credit, so credit and discounts never carry a fee, and a purchase that credit covers in full has none. The purchase stores it (`purchase.fee_cents`, with the method it was worked out for), and `total = subtotal − discount − credit + fee`. Purchase items keep the price without the fee, so a split team's balance, rain-out rebates and referral credit count only the price.

**Refunds return the fee in proportion.** A refund's amount is of what was paid, fee included. A full refund returns the whole fee (the league then bears Stripe's fee, which Stripe keeps), and a partial refund returns the same share of the fee as of the price; the refund screen shows the fee and the amount that refunds a given price. Rain-out rebates are a share of the price paid, never of the fee.

**Stripe bank transfers are a second switch, for season fees only.** Bank transfers (ACH Direct Debit through Checkout) are offered only when an admin also turns them on, and only for registration and a captain's team balance, where amounts are large and there is time for a payment that takes a few business days. A purchase whose bank transfer is processing is marked (`purchase.processing_since`): a second "Pay" does not expire it, its holder is told it is on its way, and the captain guarantee's deadline charge waits until it clears or fails. Tickets and the shop stay card only, because their checkouts hold a spot or stock for an hour.

**Only where a free method can be used.** Two-tier pricing is a discount only if the cheaper methods are really on offer. Season fees have them: a captain or admin records cash, Zelle, check or Venmo against a registration, and the team's balance counts it. Event tickets, the shop and private events are paid only through Checkout, with no way to record a free payment, so a fee there would be a card surcharge in all but name. They stay at their price until they can take a recorded payment. The captain guarantee's deadline charge is a card payment for a season balance: it charges the card price, says so when the card is saved and in the 72-hour warning, and the captain can still have teammates pay with a free method before then.

**Zelle and check join cash and Venmo as recorded methods** at all times. They change no amount, so they are not behind the setting.

**Behind an admin setting, off by default.** `league.processing_fees` holds the switch, the bank-transfer switch, the rates, whether Venmo is a business profile, and what to tell payers about the free methods (for example who takes cash and where to send Zelle). While it is off, every amount, every Checkout session and every screen is exactly as before. The settings screen lists what the league must confirm before turning it on: its adviser's sign-off, Stripe's (and its acquirer's) agreement and any notice they ask for, and the posted card prices.

## Alternatives considered

- **A card surcharge that detects the card type.** It matches the issue's wording, but in Stripe it needs the private-preview automatic surcharge, an embedded Checkout rebuilt on the Payment Element, and a paid third-party provider, which the free-services rule ([ADR 0021](0021-free-services-only.md)) forbids. Building our own detection (collect the card with the Payment Element, read its funding type, then confirm with a surcharge) needs a preview API version and client code on every payment page, and the league would carry the network notice and per-state rules for each payer. It is the right design to revisit once Stripe's surcharging is generally available in hosted Checkout without a paid provider.
- **An admin choice of either approach.** It doubles the money paths and their tests while one of the two cannot be built within the rules today. The setting's shape (a mode) leaves room to add it.
- **Raising every price by the card fee.** Simple, but cash and Zelle payers would pay for card fees they do not cause, which is the opposite of what the league wants.
- **Keeping the fee out of refunds.** It saves the league the fee on a refund, but card-network practice and Stripe's guidance return a surcharge in proportion, and a payer who is refunded in full expects all their money back.

## Consequences

- Tickets, the shop and private events take no fee for now; offering a recorded payment there is a separate change.
- One migration: `league.processing_fees` (jsonb, off by default), `purchase.fee_cents`, `purchase.fee_method`, `purchase.fee_saved_cents` and `purchase.processing_since`, the purchase amount check including the fee, and `zelle` and `check` as payment methods.
- With the setting off nothing changes; tests pin every amount.
- The owners' books show fees covered by payers and fees saved by free methods; receipts and the payment history show the fee as its own line.
- The league owns the legal side. Before switching on it should confirm the program with its adviser and with Stripe, give any notice Stripe or its acquirer asks for, and keep the card price posted wherever it advertises a price.
- If Stripe changes its prices, an admin updates the rates; the fee is never more than the rates entered.

## Sources

- Stripe: [surcharges in Checkout](https://docs.stripe.com/payments/advanced/surcharge), [card surcharges](https://docs.stripe.com/payments/cards/surcharge), [surcharge fees](https://stripe.com/resources/more/surcharge-fees), [pricing](https://stripe.com/pricing)
- New York: [General Business Law § 518](https://www.nysenate.gov/legislation/laws/GBS/518), [Department of State notice of the February 2024 change](https://content.govdelivery.com/accounts/NYSDOS/bulletins/38661fe)
- Visa's 3% cap from April 2023: [Payments Dive](https://www.paymentsdive.com/news/visa-new-credit-card-surcharge-cap-payments-ISO-merchant/647695/)
