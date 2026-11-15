# Unit test coverage, November 2026

A one-time review of where the unit tests leave logic unchecked, and what was
done about the riskiest gaps. Run with `npm run test:coverage`, widened to
`src/domain`, `src/lib` and `src/services` (the configured run measures only
`src/domain` and `src/lib`). Thresholds were not changed.

## Totals (widened run, 275 test files, 3,549 tests)

| Measure  | Covered |
| -------- | ------- |
| Lines    | 92.58%  |
| Branches | 89.78%  |

`src/db/queries` is not measured by the unit run: its tests need Postgres and
run with `npm run test:db`. Each query file has a `.db.test.ts` beside it.

## Least-covered files that hold real logic

Files of at least 10 lines, by uncovered lines before this change. "Now"
marks the files this change gave tests to.

| File                              | Lines | Branches | What it holds                       | Now                                         |
| --------------------------------- | ----: | -------: | ----------------------------------- | ------------------------------------------- |
| `src/services/outbox.ts`          |   26% |      37% | notification drain, digests, release | tested (batching, totals, failure, no channel) |
| `src/domain/dashboard/csv.ts`     |   33% |      50% | dashboard export, money and rates   | tested                                      |
| `src/domain/books/ledger-csv.ts`  |   16% |       0% | the owners' tax ledger              | tested, with properties                     |
| `src/services/stripe-guarantee.ts`|    0% |       0% | saved card, deadline charge         | tested against the real SDK, fake network   |
| `src/lib/guarantee-charges.ts`    |    0% |       0% | daily guarantee run                 | tested                                      |
| `src/domain/books/forms.ts`       |   55% |      36% | owners' money forms                 | tested, with a property                     |
| `src/domain/dashboard/report-csv.ts` |  56% |      70% | report card export                  | tested                                      |
| `src/domain/money/credit.ts`      |   82% |      76% | credit text and money lines         | tested                                      |
| `src/lib/weather.ts`              |   35% |      23% | weather lookups for game day        | open                                        |
| `src/lib/auth/permission.ts`      |   50% |      23% | request-bound permission checks     | open: needs a request; covered by e2e       |
| `src/lib/social/sync.ts`          |    0% |       0% | social sync                         | open                                        |
| `src/lib/widget/data.ts`          |    0% |       0% | widget data                         | open                                        |
| `src/lib/static-params.ts`        |    0% |       0% | build-time params                   | open: build glue                            |
| `src/lib/game-cache.ts`           |    0% |       0% | cached game reads                   | open: database-backed                       |
| `src/lib/league/public.ts`, `active.ts` | 0% |      0% | league lookups                      | open: database-backed                       |

The scheduler, standings, scoring and permission rules (`src/domain/scheduler`,
`standings`, `scores`, `authz`) were already at 100% of lines and at least 96%
of branches. `src/domain/money` was at 94% of lines and 88% of branches before
the credit tests were added.

## What the new tests check

- **Ledger CSV:** a refund is a separate negative line, only when something was
  refunded; a payment is dated by the league's calendar, not UTC; permit costs
  with no cost are skipped; lines sort by date; for any mix of payments,
  refunds and expenses the lines add up to paid less refunded less spent; a
  formula-looking note is defused while amounts stay numbers.
- **Books forms:** typed dollars never drift (property over all cent values);
  impossible dates such as 30 February are refused; each form names its first
  problem in order.
- **Dashboard and report CSV:** money in dollars, refunds negative, rates as
  one-decimal percentages, a missing rate left empty rather than zero.
- **Notification outbox:** batches add up and stop at the first empty one or at
  the limit; a failure releasing scheduled announcements is logged and does not
  stop the send; with no channel configured nothing is sent.
- **Captain guarantee:** the charge uses the purchase as its idempotency key; a
  decline is recorded and counted, other errors are retried by the next run; a
  Stripe error on one charge does not stop the others; the saved card's details
  come from Stripe or fall back safely.

No defects were found in the code under test.
