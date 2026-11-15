# Kickball League

> One site to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, and the owners' books, all usable from a phone at the field.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) (an earlier build: automatic deployments are paused until launch) · **Status:** feature complete. Card payments, email and push stay off until their accounts are configured (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md)). Read the [case study](docs/case-study.md) for how it is built and why.

## The problem

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, refs text scores from the sideline, and nobody can find the standings. The league's owners also have to hold park permits, insurance and the books together.

This project replaces the patchwork with one site. Players register, sign the waiver and pay in a few taps. The schedule is generated fairly and re-planned when it rains. Refs enter scores with no signal. Everyone is told only what concerns them. The first deployment targets a Brooklyn league that plays at McCarren Park, and one deployment can host several leagues.

## Screenshots

> Screenshots are added once the launch build is live. Until then, `npm run demo` runs the whole app on one laptop ([walkthrough](docs/demo.md)).

| Player home   | Public schedule | Game day command center | Schedule board |
| ------------- | --------------- | ----------------------- | -------------- |
| _placeholder_ | _placeholder_   | _placeholder_           | _placeholder_  |

## Features

Highlights by audience. The complete list, with every rule and edge case, is in [docs/features.md](docs/features.md).

**Players**

- Sign up with an email link, Google or a passkey; sign the waiver, confirm the age check and pay by full or split pay through Stripe, with promo codes and league credit applied.
- Join a team by invite link or as a free agent; a matcher finds the best-fit team and keeps friends together.
- RSVP, see the kicking order, find and take sub spots, and check in at the field by scanning a rotating QR code.
- Live scores, standings, power rankings, pick'em for bragging rights, awards votes and an end-of-season card to share.
- An installable phone app: the next game opens with no signal, and push messages cover rain-outs and sub requests.
- Download everything the league holds, or delete the account.

**Captains**

- Register a team, share the invite link and see who has joined, signed and paid; a card on file guarantees a split-pay team's balance.
- Send blackout dates and time preferences before the schedule is made; build kicking orders that check the league's gender-run rule.
- Ask for subs, answer score confirmations, see availability by week and hand the team to a co-captain.
- Keep a private "not on my team" list and download the team's roster and payments.

**Refs**

- See assigned games, take an uncovered game with one tap, enter the final score or keep score live inning by inning, with offline entry that syncs when the signal returns.
- Report incidents and see the permit for the field they are at.

**Admins**

- Generate a season schedule, see why any game could not be placed, edit on a drag-and-drop board, publish versions with a diff and run playoffs.
- Call a rain-out with a weather decision card, a preview of makeups and notices to only the players affected.
- A game-day command center, a ref assigner and pay sheet, rule changes with a dated change log, sub, concern and incident queues, and an audit log.
- Divisions with crossover games, season rollover, events with tickets and giveaways, sponsors, and photo review.

**Owners**

- The books: money in from recorded payments, expenses with receipts, expected costs, statement import and a CSV for taxes.
- Park permits, fees, renewals and a capacity planner; the schedule cannot be published outside a documented permit.
- A dashboard, a season report card, win-back list and a public "where the money goes" page.
- Several leagues on one deployment, and a platform operator role above the owners.

**Everyone, signed in or not**

- Public schedule, standings, team, game, event, sponsor and field pages as static HTML that paints fast on a phone, with share images and a calendar feed per team.

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Drizzle on Neon Postgres · Better Auth · Stripe · Resend · Vercel

Quality: Vitest (unit, property and database tests) · fast-check · Playwright with axe · Lighthouse CI · gitleaks secret scanning · GitHub Actions

Every service runs on its free tier, and no feature needs a paid plan, a paid API key or a monthly bill ([ADR 0021](docs/adr/0021-free-services-only.md)). Each free limit and what the site does near it is in the [free-tier budget](docs/architecture.md#15-free-tier-budget).

## Getting started

Requires Node 24 (`nvm use` reads `.nvmrc`).

To see the app with nothing to set up but Docker or a local Postgres:

```bash
npm run demo
```

It builds and starts the whole app in demo mode on this computer, offline, and opens the browser. To work on the code:

```bash
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL is your own Neon branch
npm run db:migrate           # apply migrations to that branch
npm run seed                 # a demo league: 8 teams, invented players, a season half played, three past seasons; plus a small second league
npm run dev
```

Environment variables are validated with Zod in [`src/lib/env.ts`](src/lib/env.ts), so the app stops at startup and names any variable that is missing or malformed. Optional integrations (Google sign-in, web push, Instagram, the email quota), a local Postgres for the database tests and demo mode on a deployment are covered in the [development guide](docs/development.md). Going live is in the [launch kit](docs/launch/README.md).

## Scripts

| Command                      | What it does                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | Start the development server                                                                                    |
| `npm test`                   | Run unit and property tests once                                                                                |
| `npm run test:coverage`      | Run unit tests with coverage of `src/domain` and `src/lib`                                                      |
| `npm run test:db`            | Database constraint tests against a real Postgres (each rolls back)                                             |
| `npm run test:e2e`           | Seed, build, then smoke tests and core flows with axe                                                           |
| `npm run test:e2e:site-wide` | Reseed, then the operator's site-wide switches on their own                                                     |
| `npm run lighthouse`         | Lighthouse budgets on the public pages of the last build                                                        |
| `npm run check:route-js`     | Every route's first-load JavaScript against its budget                                                          |
| `npm run lint`               | ESLint, failing on any warning                                                                                  |
| `npm run typecheck`          | Generate route types and run `tsc`                                                                              |
| `npm run format:check`       | Check Prettier formatting                                                                                       |
| `npm run build`              | Production build                                                                                                |
| `npm run db:generate`        | Generate a SQL migration from `src/db/schema`                                                                   |
| `npm run db:migrate`         | Apply pending migrations to `DATABASE_URL`                                                                      |
| `npm run db:check`           | Check migration files are consistent                                                                            |
| `npm run db:studio`          | Browse the database in Drizzle Studio                                                                           |
| `npm run seed`               | Replace the demo league and the small second league with fresh seed data; refuses production                    |
| `npm run demo`               | Run the whole app locally in demo mode, offline, for showing the league ([walkthrough](docs/demo.md))           |
| `npm run demo:reset`         | Reseed the demo deployment, bring its season up to today and start a game night; refuses unless demo mode is on |
| `npm run push:keys`          | Add a new VAPID key pair for web push to `.env.local`                                                           |
| `scripts/backup-drill.sh`    | Back up a database, restore it to a scratch database and compare ([steps](docs/launch/backup-and-restore.md))   |

## Testing and CI

- **Unit and property tests** (Vitest, fast-check): the scheduler, standings, permissions, pricing, the matcher and the other rules live in `src/domain` as pure functions, with property tests for the scheduler's and matcher's promises.
- **Database tests** run against a real Postgres, each in a transaction that rolls back, to prove the constraints, locks and idempotency the app relies on.
- **End-to-end tests** (Playwright with axe) walk a whole season and one journey per role, check every key screen for accessibility, and send Stripe calls to stripe-mock.
- **Lighthouse CI** holds each public page to its performance and accessibility budgets on a throttled phone profile, and a route-by-route first-load JavaScript check runs on every pull request.
- **Hygiene and security:** secret scanning over the whole history, a migrations check (consistent, idempotent, no schema change without a migration) and a pull request check for text that must not reach GitHub.

A pull request that changes only Markdown or `docs/` skips the heavy jobs and still reports every required check. The layout and sharding are in [architecture](docs/architecture.md#11-continuous-integration); running the checks locally is in the [development guide](docs/development.md).

## Documentation

| Document                                                     | What it covers                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Case study](docs/case-study.md)                             | The problem, constraints, architecture, deep dives, trade-offs and numbers       |
| [Features](docs/features.md)                                 | Every feature by area, in full                                                   |
| [Development guide](docs/development.md)                     | Optional integrations, local databases, end-to-end tests, how changes land       |
| [Product spec](docs/product-spec.md)                         | Roles, permissions matrix, features by phase                                     |
| [Information architecture](docs/information-architecture.md) | Routes, user flows, key screens                                                  |
| [Data model](docs/data-model.md)                             | Tables, constraints, indexes                                                     |
| [Scheduling algorithm](docs/scheduling-algorithm.md)         | The season scheduler and its property tests                                      |
| [Architecture](docs/architecture.md)                         | Stack, rendering, auth, jobs, webhooks, security, CI, free-tier budget           |
| [Design system](docs/design-system.md)                       | Tokens, type, components, motion, performance budgets                            |
| [SEO plan](docs/seo-plan.md)                                 | Metadata, structured data, content                                               |
| [Roadmap](docs/roadmap.md)                                   | Phases and acceptance criteria                                                   |
| [Launch kit](docs/launch/README.md)                          | Hosting brief, environment checklist, runbook, backups, acceptance tests, alerts |
| [Security review](docs/security-review.md)                   | Findings, fixes and follow-ups                                                   |
| [Demo walkthrough](docs/demo.md)                             | A 10-minute tour from one laptop                                                 |
| [Decisions](docs/adr/)                                       | Architecture decision records, one per real trade-off                            |

Decisions worth reading first: [stack and tooling](docs/adr/0001-stack-and-tooling.md), [static public pages](docs/adr/0008-static-public-pages.md), [free services only](docs/adr/0021-free-services-only.md), [captain guarantee and league credit](docs/adr/0022-captain-guarantee-and-league-credit.md), [offline scores](docs/adr/0025-offline-scores-keep-the-servers-version.md) and [several leagues on one deployment](docs/adr/0048-several-leagues-on-one-deployment.md).

## Project layout

`src/domain/` holds pure TypeScript (the scheduler, standings, permissions, pricing) with no framework or database imports, enforced by a lint rule. That is where the interesting logic and most of the tests live. `src/app` holds the routes, `src/db` the schema and queries, and `src/services` the integrations. See [architecture](docs/architecture.md#code-layout).

Contributions follow [`AGENTS.md`](AGENTS.md): small Conventional Commits, one pull request per issue, rebase merges onto a protected `main`.
