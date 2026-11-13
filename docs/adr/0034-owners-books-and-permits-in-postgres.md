# ADR 0034: The owners' books and permit helper, with files in Postgres

- Status: accepted
- Date: 2026-11-13

## Context

The owners asked to track money in and out, and to stay on top of park permits (product spec, section 9, "Running the league"). Six questions needed an answer: where income comes from, where receipt photos and permit documents live, who sees what, how the app helps with a permit when NYC Parks offers no API, how a ref proves the permit at a field with no signal, and how the owners hear about deadlines.

The site must cost nothing to run ([ADR 0021](0021-free-services-only.md)). The project has no file store, and the database's free tier (1 GB) is shared with every table. NYC Parks takes permit applications on its own site, has no public API, and its terms do not invite automation.

## Decision

**Income is read from what the app already records**, never fetched from Stripe: succeeded payments for the season's purchases (in the app or recorded as cash, Venmo or other), less what was refunded on them. A purchase with no season, such as an event ticket, counts toward the season running on the day it was paid, in the league's time zone. League credit spent at checkout is shown beside the total but not counted, because the league gave that credit earlier and counting it would count it twice. Stripe's fees are not recorded by the app, so the ledger is gross of them; Stripe's own reports have them. The totals are a pure function (`src/domain/books/ledger.ts`) with unit tests.

**Expenses** have a date, an amount, one of seven categories, a note and an optional receipt photo. A permit window's cost is part of the books: the owners enter a permit's total once, and it is split across its windows, earliest first, so the shares add up exactly and each counts under "Fields and permits".

**Files are stored in Postgres** (`books_file`, `bytea`), the approach ADR 0023 took for Instagram photos, with tighter limits:

| Limit | Value | What happens |
|---|---|---|
| One photo | Shrunk in the browser to 2,000 px, then on the server with sharp to at most 1,600 px on its longer side, one WebP at quality 72 (50 if still over 1 MB) | A receipt ends up around 150 to 400 KB. The metadata is dropped, so a phone's location never reaches the database |
| One PDF | Kept as uploaded, recognized by its first bytes, at most 1 MB | A larger PDF is refused with a message to save it smaller or take a photo instead |
| All files | 50 MB per league, checked under an advisory lock, so two uploads at once count each other | An upload past the cap is refused with a message to download the books and remove old receipts; nothing is deleted on its own |

50 MB is 5% of the free tier. A database check also holds each row to 1 MB and to WebP or PDF. Files are served only from two private routes, with `Cache-Control: private, no-store`, `nosniff` and `default-src 'none'`, and a PDF is sent as a download rather than shown inline. Server Actions accept up to 4 MB (`next.config.ts`), under Vercel's 4.5 MB request limit, for a 1 MB PDF or a photo sent without JavaScript.

**Only owners and the platform operator see the books.** A new permission, `books.manage`, is the owner's or the operator's; the subject gains an `isOperator` flag, set from the server's environment when a page or action loads it. Admins never see expenses, receipts, permit costs or documents, or the insurance certificate, and the books' audit rows (`books.*`) are left out of the audit log for anyone without `books.manage`. The owners' league export includes the books' rows and file details, not the file bytes.

**The permit at the field is the one exception.** A game's ref and both captains (`permit.view_at_field`) see the permit number, field, hours and document on `/app/games/[game]/permit`, linked from their home screen and the score page. The home screen tells the service worker to save that page and its document with the next game, for those people only; the worker accepts the permit only for the same game, fetches it with the person's cookies, and deletes it on sign-out. Admins do not get this right: they manage permit windows on the fields screen but do not need the document.

**A request sheet, not an integration.** "What to request" works out, from the number of teams, the game day, the first game, the end of the day and the slot length, how many games each game day has, the fewest fields that hold them, and each field's hours rounded up to the half hour, for every game day in the season except league-wide blackouts (`src/domain/books/request-sheet.ts`). The owners copy it into the NYC Parks application or download it as a CSV. Nothing is submitted, scraped or automated.

**Reminders through the outbox.** A daily job emails every owner 30 and 7 days before a permit application window opens, a permit renews, or the newest insurance certificate expires. A missed day still sends the closest reminder, and each is queued once per deadline, milestone and owner. The reminders use the `announcement` topic until the outbox has an operations topic for staff.

**Lost permits.** When an admin marks a permit window lost, the games still to play on its slots are listed on the fields screen and the owners' permits screen, with a link to the schedule board to move them. The permit page warns a ref or captain who opens it.

## Alternatives considered

- **Reading income from Stripe's API.** Exact fees and payouts, but an outside call for every view, a second source of truth beside the webhook-fed payments, and nothing for cash and Venmo.
- **Vercel Blob for receipts and documents.** Better for many or large files, but a new package and store, another free allowance to watch, and a private Blob read still goes through a function. The files sit behind one table and two routes, so moving them later changes `storeFile` and those routes, not the pages.
- **A separate `permit` table above `permit_window`.** Cleaner for a permit's details, but the scheduler, fields screen and seed all work with windows, and the task was to extend them. Grouping by permit number (or by field when there is none yet) gives the owners one place to edit a permit's details.
- **Automating the NYC Parks application.** No API, terms that do not invite it, and a risk to the league's standing with the department that grants its fields.
- **Letting admins see permit documents.** Admins run game day and could use them, but the owners asked to keep the books, costs included, to themselves. The ref and captains of each game cover the field.
