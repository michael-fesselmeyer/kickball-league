# ADR 0059: Expected costs, statement imports and keeping the books up to date

- Status: accepted
- Date: 2026-11-14

## Context

The owners' books (ADR 0034) were correct but slow to keep. Every expense was a form with a date, an amount, a category, a note and a receipt photo. The same costs were typed again every game day: ref pay, permits, the bar deposit. Payments made with an owner's own card or Venmo were not recorded as owed. Receipts were the hardest part to keep track of.

The site must cost nothing to run (ADR 0021). Paid options are out: OCR services that read receipts, AI categorizers, and bank aggregators such as Plaid. Venmo has no public API for personal statements, and the banks have none for a league's checking account.

## Decision

**Quick add takes three taps.** The amount field, the categories as large radio buttons, and "Add expense". The category of the league's newest expense starts picked, because owners tend to enter several of a kind at once. Date (today), note, receipt and who paid are folded under one disclosure.

A receipt has three states:
- attached;
- "add it later" (the default);
- "there isn't one" (`no_receipt`), which counts as settled.

An expense waiting on a receipt shows "Add a receipt" and "There isn't one" in place. A database check keeps "no receipt" and an attached receipt apart.

**Expected costs are worked out, not stored.** An owner sets a `recurring_cost` once: a label, category, usual amount, a cadence of "each season" or "each game day", and a start date. A season cost is due on the season's first day. A game-day cost is due on each local day with a game that isn't cancelled or postponed. Both come from the season and the schedule, so a rained-out day disappears without anyone touching the books.

The books list due occurrences with the amount filled in. "Confirm" adds an ordinary expense carrying `recurring_cost_id` and `due_on`, unique with its season, so two owners tapping at once add it once. "Skip" adds a `recurring_cost_skip` row for the season. Removing a cost archives it, so the expenses it settled keep their link.

Dates move, so each settled occurrence belongs to its season:
- Seasons can overlap, and both can have games on the same day.
- A season cost that was confirmed or skipped stays settled for that season if the season's first day changes later.
- A game day that moves before anyone confirms it is expected on its new day.
- A confirmed day keeps its expense even if its games move afterwards, because the money was spent.

**Ref pay comes from the pay sheet when a season has one.** ADR 0053's pay sheet adds a Refs expense to the books each time a ref is marked paid. In a season with a per-game fee set there:
- a game-day expected cost in the Refs category isn't expected, so ref pay isn't counted twice;
- the books' expected section shows the pay sheet's games worked, fee and what is still to pay, with a link to it;
- the payout record stands in for a receipt, so a payout's expense never counts as missing one, and is tagged "From the ref pay sheet".

A season with no fee set keeps a Refs expected cost as usual, for leagues that pay refs a flat amount per game day.

**Out of pocket.** An expense can name an owner as `paid_by`. The books sum what each owner is owed across seasons. "Reimbursed" stamps `reimbursed_at` on exactly the expenses that were listed, so one added in the meantime stays owed. Only owners can be named as payers: they are the people who see the books.

**Statement import from a file the owner downloads.** Venmo's statement CSV and banks' transaction exports are read in memory and never stored. The import reads:
- a date column (US month-first or ISO);
- an amount column or separate debit and credit columns. A minus sign anywhere, parentheses or "DR" mean money out. Amounts are read as text to the cent, never as floating point;
- a description: Venmo's "To" and "Note", or the bank's description, payee or name.

The file is decoded as UTF-8 (with or without a byte-order mark), as UTF-16 when it starts with one, or as Windows-1252 when the bytes aren't UTF-8.

Every other column is ignored, including card and account numbers. Any run of five or more digits in a description is masked to its last two digits before the description is used.

Several kinds of row are left out:
- Money in (payments, refunds, transfers in), because the ledger reads income from the payments the app records (ADR 0034). A refund from a shop is money back: the owners remove the expense, and add the part they kept.
- Venmo transfers to a bank, and $0 lines.
- Venmo rows that aren't complete.

A preview lists the rows before anything is added. Each row shows a category guessed by merchant rules: the owners' own rules first, then a short built-in list, with the longest matching pattern winning. Rows are deduplicated two ways:
- `import_key` is a SHA-256 of the row's key, scoped to the league. The key is Venmo's transaction ID, or else the date, amount, description and position among identical rows. A row whose key is already in the books is skipped, so importing an overlapping statement adds nothing twice.
- A row with the same amount as a hand-entered expense within three days starts unticked, as possibly the same payment.

Two more kinds of row start unticked:
- a description that reads like a transfer between accounts;
- a date more than 120 days before or 30 days after the season it would go into, so a year's statement doesn't land in one season by accident.

The statement line stands in for a receipt, so imported rows don't count as missing one.

**A monthly nudge.** The daily books job already sends permit and insurance reminders. In the first week of each month it also queues one `books_nudge` per owner. The nudge lists expected costs not yet confirmed and expenses waiting on a receipt, in seasons that aren't over. It is sent only when something is waiting, and its dedupe key is the month and the owner. It uses the staff-only `operations` topic and is non-urgent (ADR 0019), so quiet hours and the daily cap apply. Because the first week counts, a missed daily run still sends it, and no new scheduled job is added.

**Not done: a Web Share Target for the installed app.** Accepting a shared photo means either a service worker that holds the file until the form opens, or a route that stores an unattached receipt and cleans up abandoned ones. Neither is small, and neither can be checked here on an Android device, so iPhone and Android users both use the upload button for now.

## Alternatives considered

- **Reading receipts with OCR or AI.** It would fill in the amount and merchant, but every free option is either a paid API past a tiny quota or a large client bundle, against ADR 0021 and the books page's JavaScript budget.
- **A bank aggregator (Plaid, Teller).** It would make imports automatic, but it costs money per connected account, needs the owners' bank credentials held by a third party, and would put account numbers within reach of the app.
- **Storing every expected occurrence ahead of time.** It would be simpler to query, but the rows would have to be rewritten whenever the schedule changes (a rain-out, a moved game day) and cleaned up when a season's dates change. Working them out from the schedule keeps them right for free.
- **Keeping the uploaded statement for an audit trail.** It would help retrace an import, but a statement holds names, balances and account numbers that the books don't need. The audit row records how many rows were imported and their total.
- **Reimbursing one expense at a time.** It would be more precise, but owners settle up in one transfer; a per-person button with the listed expenses frozen covers that and still leaves anything newer owed.
