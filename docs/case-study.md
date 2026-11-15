# Case study: running an adult kickball league on one free site

This is how the league's software is built and why. It covers the problem, the constraints that shaped every decision, the architecture, five parts worth a closer look, how it is tested, and what was left out. Every number comes from the repository as of the date at the end.

## The problem

A recreational adult league has about a dozen teams, a few hundred players and a handful of volunteers. It runs on a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. That works until something changes:

- It rains at 3 pm and every affected player has to learn their own game's new time, and nobody else should be pinged.
- A captain has to collect money from fourteen teammates before a deadline.
- A ref with no signal at the park has to report a score that two captains then confirm.
- The owners must hold a city park permit that covers every game, keep insurance current, and keep books that match the payments.
- Someone has to build a season schedule where every team plays every other team at a fair spread of times and fields, around every team's blackout dates, and rebuild it when games are lost.

The product is one site for all of it, for five kinds of user: players, captains, refs, admins and owners. [The feature list](features.md) has the detail; this document is about the decisions underneath it.

## Constraints

Four constraints did most of the design work.

**It must cost nothing to run.** The league is run by volunteers. [ADR 0021](adr/0021-free-services-only.md) makes it a rule: no feature may need a paid plan, a paid API key or a monthly bill, and a feature with no free option is left out. Hosting (Vercel Hobby), the database (Neon Free), email (Resend Free), error monitoring, analytics and CI (GitHub Actions on a public repository) all stay on free tiers with no payment method on file, so a limit can stop a service but never bill it. The [free-tier budget](architecture.md#15-free-tier-budget) records each limit from the provider's own page, what it means at 12, 50 and 200 teams, and what the app does as the limit nears. This ruled out Redis, a realtime service, object storage beyond a small allowance and paid maps or weather. It also explains several designs below: files live in Postgres under hard caps, live scores are polled, and background work rides on the outbox.

**Players are on phones, often at a field with no signal.** The public pages must paint fast on a mid-range phone on a slow connection. The screens used at the field (scores, check-in, the game-day checklist, the permit a park officer may ask to see) must work offline.

**Speed is a budget, not a wish.** [The performance budgets](design-system.md#performance-budgets) are enforced in CI on a throttled phone profile: Largest Contentful Paint at or under 2.0 s, layout shift at or under 0.05, total blocking time at or under 150 ms, a Lighthouse performance score of 95 or more, and first-load JavaScript limits per route group (165 kB for marketing pages up to 295 kB for the schedule board). A miss is a bug to fix in the same change; the budgets do not move to fit a change.

**Everyone must be able to use it.** The Lighthouse accessibility score must be 100 on every measured page, Playwright runs axe on every key screen (and in the dark theme and at phone width for screens no flow visits), touch targets are at least 44 px, and everything works from a keyboard, including the schedule board's drag and drop.

A fifth constraint is quieter: the league holds birth dates, emergency contacts, payments and discipline records, so privacy is designed in. Emergency contacts are encrypted and readable only on game day by the people at the field; deleting an account anonymizes the person while keeping rosters and money correct; sportsmanship ratings are shown to captains only in blocks of three.

## Architecture

Next.js 16 with the App Router and Cache Components, React 19 and strict TypeScript, on Vercel. Drizzle talks to Neon Postgres. Better Auth handles sign-in (email links, Google and passkeys). Stripe takes payments, and Resend and web push deliver messages. The [architecture document](architecture.md) has the full picture; the shape is:

- **A pure domain core.** `src/domain` holds the rules as plain TypeScript functions: the scheduler, standings, permissions, pricing, the free-agent matcher, the kicking-order checker, stats and more, in 70 modules. They import no framework and no database, and a lint rule enforces it. The pure core is where most of the tests are, and why they run in milliseconds.
- **Thin queries and actions around it.** `src/db` holds the schema (146 tables, 77 migrations) and queries; routes and Server Actions load data, call the domain and write the result. Rules that depend on concurrency (who holds the last spot, who spends the same credit) are enforced by row locks and unique indexes, not by application checks alone.
- **Static public pages, dynamic signed-in app.** Public pages are static HTML read from tagged caches. Everything under `/app` is dynamic and never cached across users.
- **One database, one queue.** Postgres holds data, the message outbox, the rate-limit counters and (under caps) uploaded files. There is no other state store.
- **Several leagues on one deployment** ([ADR 0048](adr/0048-several-leagues-on-one-deployment.md)): the default league keeps the site's own URLs and every other league lives at `/l/<league>/...`. A schema test fails if a new table with season or team data is not scoped to a league.

Why this shape: the free tiers reward a small number of cheap, boring pieces, and the product's risk is in its rules, not its plumbing, so the rules are the part that is pure and heavily tested.

## Deep dives

### 1. The scheduler

Building a fair season is a sports-timetabling problem: pair every team with every other team, give each team a fair spread of kickoff times and fields, respect each team's blackout dates, keep spare slots for makeups, and never place a game where the league has no permit. The general problem is NP-hard, so the design is a staged heuristic with an independent referee ([scheduling-algorithm.md](scheduling-algorithm.md)).

1. **Who plays whom.** The circle method builds rounds so that, at the end of any round, no two teams have met more than once more than any other pair. Byes are spread evenly for an odd team count. Divisions each get their own round robin, with crossover games woven in.
2. **Which date.** Rounds are assigned to dates, with pinned games holding their rounds in place.
3. **Which field and time, first pass.** Each day is solved as a minimum-cost assignment (the Hungarian algorithm), where a game's cost in a slot is how much it would worsen the season so far: times or fields a team has had too often, back-to-back repeats and the team's stated preferences.
4. **Which field and time, whole season.** Greedy day-by-day placement cannot see that a choice in week 2 forces a bad one in week 6, so simulated annealing improves the whole season: swapping games, whole time rows or whole fields on a date.
5. **Independent validation.** `validate` re-derives all twelve hard constraints from the output alone and shares no code with `generate`; `generate` asserts that it returns no violations.

The same function that validates a generated schedule validates a manual edit, so the drag-and-drop board can show, while a game is held, which hard rules it would break and how each fairness metric would change. A rain-out reuses the machinery: `reschedule` moves only the games that were lost, and nothing else moves.

All randomness comes from a seed in the input and the functions never read the clock or the database, so the same input always gives the same schedule. That makes it testable. Seventeen properties are checked on arbitrary generated leagues (4 to 24 teams, 1 to 4 fields, random blackouts, doubleheaders, locks): the output validates, no slot or team is double-booked, pair meetings stay balanced, the local search never makes the cost worse, locks hold, renaming teams doesn't matter, and a rain-out changes only the lost games. When a property fails, fast-check shrinks the input to the smallest failing league. A benchmark guards the target of generating a 24-team, 12-day season in under 300 ms inside a request, so no background job is needed.

### 2. Static public pages with cache tags

The schedule, standings and team pages are the most-opened pages and are read mostly on phones. Reading the database on each request put their Largest Contentful Paint near 3 s, over the 2 s budget, so [ADR 0008](adr/0008-static-public-pages.md) made them static HTML:

- Each page renders inside one `use cache` component, tagged `season:{id}` (and `team:{slug}`), with a shared lifetime constant. `generateStaticParams` lists every public season and team, so the build prerenders them and the content is in the first paint with no loading state ([ADR 0029](adr/0029-season-pages-paint-without-a-loading-state.md)).
- Every action that changes public data expires the tag, so the person who made the change sees it at once, and a scheduled revalidation catches the rest. A subtle trap, found by test, is that a page answered from its prerendered shell does not notice an expired tag on the data resumed into it, so season actions also expire the route by path ([ADR 0018](adr/0018-expire-season-routes-by-path.md)).
- Public pages show the same thing to everyone and never read cookies, headers or the query string. "My team" highlighting and the signed-in header are small client islands, so a signed-in player still gets the cached page. A view comes from the path (a team filter is a route, not a query).
- Multi-league support had to keep this property, so a page learns its league from the path segment, and `proxy.ts` rewrites the default league's URLs onto it.
- Anything that must be fresher is a separate small route: live scores are a JSON route cached for five seconds and polled by the page ([ADR 0011](adr/0011-live-scores-by-polling.md)), and the game-day command center polls its own state every ten seconds.

The result is that Lighthouse CI measures 38 public pages five times each, in eight parallel shards, against a warmed production server and a seeded database, and holds the median of each to the budgets.

### 3. The outbox

Anything that should happen after a change (an email, a push) is a row in a `message` table, inserted in the same transaction as the change. A notice can then never be sent for a change that rolled back, nor lost for one that committed.

- After the commit, `after()` drains the new rows at once, so the usual delay is under a second. A scheduled sweep catches retries, delayed sends and anything missed.
- A write that repeats is a no-op: every row carries a `dedupe_key` naming the notice (for example a payment reminder for one registration at seven days), and a unique constraint skips the second insert.
- A worker claims rows in one statement with `for update skip locked`, so two workers never take the same row, and only the claim holder records the outcome. A lapsed claim is retried with the same `Idempotency-Key`, so the provider delivers once. Failures retry with backoff and then surface on an admin health card.
- Each person's choices are read at send time: urgent news (rain-outs, sub spots, payment deadlines) goes at once, while news that can wait counts toward a daily cap (three by default) and spills into a digest, with quiet hours from 10 pm to 8 am where only urgent news goes, silently ([ADR 0019](adr/0019-urgent-and-non-urgent-messages.md)).
- Email must stay inside Resend's free quota of 100 a day and 3,000 a month, so the worker budgets it: pushes go first, urgent email goes to people without push first, news over the quota joins the digest, and urgent email that cannot go today goes after midnight UTC with admins told.
- Web push is written against the standards with Node's crypto, with no library and no paid service ([ADR 0014](adr/0014-web-push-without-a-library.md)).

Using the outbox from every feature (rain-out notices, score confirmations, waitlist offers, suspension notices) means one place owns "exactly once, to the right people, at the right urgency".

### 4. Offline scores

A ref at a park with no signal must be able to enter a score, and it must still land correctly when the signal returns, even though the server may have moved on: the other captain may have reported a different score, or confirmed one, or the same half-inning may have been saved from another phone. [ADR 0025](adr/0025-offline-scores-keep-the-servers-version.md) records the design:

- A hand-written service worker keeps the outbox in IndexedDB and sends entries oldest first, stopping at the first one that cannot go yet so live innings arrive in order. It sends when saved, by Background Sync where the browser supports it, when a page asks, and when the browser comes back online. iPhones have no Background Sync, so an entry there goes out the next time the app is opened with signal, and the screen says so ("Saved on this phone, will send when you're back online").
- Each entry carries a key made on the phone, and the server takes each entry once, so a request that arrived while its answer was lost is harmless to repeat.
- If the score changed in the meantime, the server keeps its version and tells the person what stands. Live innings are only ever a suggestion: ending a game files an ordinary report, which the captains confirm or dispute like any other.
- The same worker keeps the app shell, the signed-in person's next game, and, for the people at the field, the game's permit, emergency contacts and checklist until the day ends. Signed-in screens, payments, waivers, admin and API responses are never cached.

The worker file is tested as written against an in-memory cache and a fake network, and a Playwright test asks Chrome for installability errors.

### 5. Webhooks and the money ledger

Money is where mistakes are costly, so the rules are strict and few:

- **Only the webhook marks anything paid.** The browser returning from Stripe Checkout shows "confirming your payment" and polls. Every webhook verifies the signature against the raw body, inserts the event under a unique `(provider, event_id)` so a replay returns 200 at once, does its work in a transaction and answers 500 on failure so Stripe retries. The stored event keeps ids and types, never the buyer or their card.
- **League credit is an append-only ledger** ([ADR 0022](adr/0022-captain-guarantee-and-league-credit.md)). A balance is the sum of a player's rows. Checkout locks the player's row, applies credit after any promo code (never leaving a charge under Stripe's 50-cent minimum) and writes a negative `spent` row tied to the purchase; if that checkout expires or fails, a matching `released` row returns the credit. A unique index on (purchase, reason) makes each happen once. A stored balance column would be faster to read but can drift from its history; summing rows is cheap at league scale and the ledger is its own audit trail.
- **Holds, not decrements.** Event tickets and shop items hold their spot or stock while Checkout is open, past Checkout's own expiry, so capacity is never oversold and nothing is decremented or put back ([ADR 0027](adr/0027-event-tickets-hold-their-spot.md), [ADR 0037](adr/0037-merch-orders-hold-stock-at-checkout.md)). Buyers and webhooks take the same row lock in the same order.
- **Refunds reserve first.** An admin's refund inserts a `refund` row under a lock on the payment, then calls Stripe with that row's id as the idempotency key. Only `charge.refunded` moves the payment's refunded total, to Stripe's running total and never lower, so a replay, a late event or a refund made in Stripe's dashboard all give the right answer in any order.
- **The captain guarantee** saves a card through Stripe (the app never sees it) and, 72 hours after warning the captain, creates a purchase row, commits, then asks Stripe for an off-session charge with that purchase id as the idempotency key. Only `payment_intent.succeeded` settles it.
- **The books read the same ledger.** Income comes from recorded payments, refunds and purchases, never from a second copy, so the owners' totals cannot disagree with what players paid.

## Testing strategy

The tests follow where bugs would be expensive.

| Layer | What it proves | Size |
|---|---|---|
| Unit and property tests (Vitest, fast-check) | Pure rules: scheduler, matcher, standings, permissions, pricing, stats, lineups | About 2,360 test cases in 276 files, with 370 property assertions |
| Database tests, against a real Postgres | Constraints, locks, idempotency, outbox claiming, one vote per poll even when two arrive at once; each test rolls back | About 800 test cases in 114 files |
| End-to-end (Playwright with axe) | A whole season from setup to rain-out notice, one journey per role, every key screen for accessibility, Stripe via stripe-mock, the operator's site-wide switches | 162 tests in 69 spec files |
| Lighthouse CI | Performance and accessibility budgets on 38 public pages, five runs each | Every pull request that touches the app |
| Route JavaScript check | First-load size of every route against its group budget | Every pull request |
| Migrations check | Files consistent, no schema change without a migration, every migration applies to an empty database and is idempotent on re-run | Every pull request |
| Secret scan | No token, key or password anywhere in the history | Every pull request |
| Hygiene check | Text that must not reach GitHub | Every pull request |

Decisions that make this reliable rather than merely large:

- **Real services where they matter.** Database tests run against Postgres and not a mock, because the promises are about locks and constraints. Stripe calls go to stripe-mock, and webhooks in the tests are signed for real.
- **Steady performance measurement** ([ADR 0028](adr/0028-steady-lighthouse-measurement.md)). Five runs and the median keep one slow moment on a shared runner from failing a page that is inside its budget, while the budgets themselves never move.
- **Fast feedback.** The build is made once and shared across shards: Playwright runs on four, Lighthouse on eight, balanced by how long each page takes. A pull request that changes only documentation skips that work and still reports every required check.
- **A security review of every layer**, with its findings tracked: one High, five Medium and fourteen Low at the first pass, each High and Medium fixed with a regression test ([security-review.md](security-review.md)).

## Trade-offs and what was left out

- **Polling instead of realtime.** Live scores and the command center poll small cached routes every 5 to 15 seconds. A websocket service would feel more instant, but it needs a paid service or always-on infrastructure, and for a score that moves once an inning, polling is plenty ([ADR 0011](adr/0011-live-scores-by-polling.md)).
- **Files in Postgres, under caps.** Receipts, permit documents and photos are small, shrunk on the server and stored in the database, with per-file and total caps enforced in code and by database checks, because object storage beyond the free allowance would bill. The cost is a hard ceiling that the app explains clearly when reached.
- **A heuristic scheduler, not an exact solver.** It reaches the provable lower bound in the worked example and runs in under 300 ms at 24 teams, but it makes no optimality claim in general. Past about 40 teams in one pool the right answer is divisions, which the model already supports.
- **Daily sweeps where a minute would be nicer.** Scheduled jobs on the free plan are limited, so announcements scheduled for a day go out with the morning sweep, and the form says so ([ADR 0058](adr/0058-scheduled-announcements-ride-the-daily-sweep.md)).
- **No NYC Parks integration.** The city has no public permit API, so nothing is sent to it. The app works out what to request, tracks what is held and refuses to publish a game outside a documented permit.
- **No AI features.** No feature calls an AI provider, because every provider bills per use. The rulebook is a searchable page and the weekly recap is drafted from templates ([architecture, section 16](architecture.md#16-ai-features-not-planned)).
- **Money is recorded, not moved, for cash.** Cash and Venmo payments are entered by admins and captains, and refunds of them are marked with a note, because the league's own accounts are outside the app.
- **No native apps.** The installable web app covers the phone cases (install, push, offline) without store fees or a second codebase ([architecture, section 14](architecture.md#14-mobile-app-pwa-first)).

## By the numbers

| | |
|---|---|
| Merged pull requests | 245 |
| Architecture decision records | 61 files, numbered 0001 to 0067 |
| Database tables / migrations | 146 / 77 |
| Domain modules (pure rules) | 70 |
| Public pages in the Lighthouse gate | 38 |
| Page routes in `src/app` | 184 |
| Unit and property test cases | about 2,360 |
| Database test cases | about 800 |
| End-to-end tests | 162 in 69 spec files |
| Scheduler hard constraints / properties | 12 / 17 |
| Performance budgets | LCP at or under 2.0 s, CLS at or under 0.05, TBT at or under 150 ms, performance at least 95, accessibility 100 |
| First-load JavaScript budgets | 165 kB (marketing) up to 295 kB (schedule board) |
| Monthly cost to run | $0 (Stripe takes its fee per payment, from the league's own payments) |

_Counts are from the repository at the time of writing; test-case counts are `it` and `test` calls and are approximate._
