# Kickball League

> Software to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, built first for a Brooklyn league of 8 to 12 teams.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) · **Status:** season core in progress. Scheduling, registration, game day and the admin tools work; card payments and email are built but stay off until their accounts are configured (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md))

## Why this exists

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, and nobody can find the standings. This project replaces that patchwork with one site a player can use from their phone at the field.

The first deployment targets a real Brooklyn league that plays in McCarren Park: weeknight evenings in spring and fall, Sunday afternoons in summer. The design decisions, tests and history are written to be read.

## Features

What works on `main` today. The [roadmap](docs/roadmap.md) lists what comes next.

**Scheduling**

- A season scheduler that turns permit windows into game slots, builds round-robin rounds, places games with a min-cost assignment and improves them with local search. It checks ten hard constraints and reports fairness metrics, and property tests cover it ([how it works](docs/scheduling-algorithm.md)).
- Admins generate a draft, see why any game could not be placed, move or swap games by form, and publish. Each publish saves a version with a diff.
- Schedule board (desktop): drag a game to an open slot, or onto another game to swap them. While a game is held, the board shows the hard-rule problems and the change in each fairness metric that dropping it there would cause, from the scheduler's own checks. Arrow keys, Enter and Escape do the same without a mouse, and several changes save together as one new draft.
- Rain-outs: pick a scope, preview the affected games and proposed makeups, and confirm. Each affected player is emailed their own game's new time, and nobody else hears about it.
- Weather: upcoming game pages show the temperature at kickoff and the chance of rain from the National Weather Service, cached so pages never wait on it. About a day before each game day, admins get a "watch" or "likely" rain alert linking to the rain-out screen with that day chosen, once per level.
- Playoffs: an admin seeds the bracket from the final standings with the configured tiebreakers, and the scheduler places every round on fields and times, top seeds getting byes when the field is uneven. It publishes as a schedule version like the regular season. Winners move on as soon as a playoff score is final, and the next game appears on the schedule in its reserved slot.

**Registration and payment**

- Player profiles with an 18+ check, and versioned waivers signed before payment.
- Team registration with full or split pay, invite links, and a roster board showing who has joined, signed and paid. Free agents register solo and admins place them on teams.
- Stripe Checkout with an idempotent webhook (test mode, on once keys are set), plus cash or Venmo payments recorded by admins and captains.
- Shirt tracking: sizes by team from players' profiles, what is still to order for late joiners, and a received flag per player.
- CSV downloads of rosters (with shirt sizes) and payments: the whole season for admins, one team for its captains. Cells that a spreadsheet would run as a formula are written as text, and every download is logged.
- Players download everything the league holds about them as JSON, and can delete their account. Deleting anonymizes the person so past rosters, scores and payments stay correct, and needs a sign-in from the last 15 minutes plus their email address typed again.

**Game day**

- Refs see their assigned games and enter scores from their phone. Captains confirm or dispute, and undisputed scores become final.
- Players answer in, out or maybe, and captains see a warning when the fielding rule is at risk.
- A sub finder: a short-handed captain asks for subs for a game, with spots reserved for women or men when the fielding rule needs them. Registered players with a signed waiver who are free at that time hear about it by email (free agents first, and only if sub alerts are on). A player's "I'm in" holds a spot until the captain approves or declines, so two players can never take the last spot at once. Both captains and the ref see who is playing as a pickup. Not offered for playoff games.
- Public standings with the configured tiebreakers.
- An installable app: a web app manifest with the league's icons and light and dark theme colors, and a service worker that keeps the app shell and each signed-in person's next game on the phone, so the game page opens with no signal (marked as a saved copy) and anything else shows an offline page. Signed-in screens, payments, waivers, admin and API responses are never cached. Captains, refs and admins are offered the install from their second visit on; "Not now" is remembered.

**Score stats**

- Power rankings from record, recent form, run difference and strength of schedule, with each team's movement since the last game day.
- Win and loss streaks, the all-time series between any two teams, a game of the week for the next game day, and a league records page. All of it is computed on demand by pure, property-tested functions in `src/domain/stats`.
- A weekly recap drafted from templates (results, rankings, streaks, new records, next week's big game) that an admin edits and sends as an announcement through the outbox.
- A league history page: every completed season with its champion and final standings, and an all-time table. Team pages show the team's all-time record (wins, losses, ties, run difference) and the titles it won, added up from each season's standings in `src/domain/history`.

**Messaging**

- A transactional outbox: messages are written with the change that caused them, failed sends retry, and nothing sends twice.
- League and team announcements, with per-person email settings.
- Payment reminders 7, 3 and 1 days before the deadline, and missing-score reminders to the ref and then the captains.

**Admin**

- Season setup, fields, permits and blackout dates.
- A dashboard for the next game day: games, refs, RSVP warnings, missing scores, and registrations, payments and waivers by team.
- An audit log of admin actions, and a permissions matrix enforced by one tested function.

**Public site**

- Public schedule, team and game pages. Anyone can see the season schedule (filter by team), each team's record, next game, results and roster (first name and last initial), and each game's time, field and score. Pages read only the published schedule version, never a draft.
- A playoff bracket page that draws winners' lines as it loads (still under reduced motion), with a plain list view of the same bracket.
- Team calendar feeds: every team has an `.ics` feed that Apple Calendar, Google Calendar and Outlook can subscribe to. Moved or rained-out games update in place.
- Home, About, FAQ and a park page, with a generated sitemap, robots file and structured data for the league, teams and games.
- Search landing pages: a city-wide page with subway routes and rough travel times from every borough, a free-agent page that explains joining without a team, and a "how to play kickball" guide. Each carries its own metadata and structured data (league, FAQ and article) and is linked from the home page and the sitemap.
- Sharing to WhatsApp: every game and team has a generated share image (1200 × 630, in the league's colors) for link previews, with the score on a final. One tap on a game or team page opens WhatsApp with a ready-made message and the link; a second button opens the phone's share sheet or copies the message. Admins can copy a rain-out notice, with every makeup, and any sent announcement as one message for the group chat.

**Demo mode**

- Turned on only by a server environment flag and refused in production: a banner on every page and one-tap "view as" a player, captain, ref or admin, plus a reset script that reseeds the demo database.

**Sign-in**

- Email links and, when configured, Google.

## Design documents

| Document                                                     | What it covers                               |
| ------------------------------------------------------------ | -------------------------------------------- |
| [Product spec](docs/product-spec.md)                         | Roles, permissions matrix, features by phase |
| [Information architecture](docs/information-architecture.md) | Routes, user flows, key screens              |
| [Data model](docs/data-model.md)                             | Tables, constraints, indexes                 |
| [Scheduling algorithm](docs/scheduling-algorithm.md)         | The season scheduler and its property tests  |
| [Architecture](docs/architecture.md)                         | Stack, rendering, auth, jobs, security, CI   |
| [Design system](docs/design-system.md)                       | Tokens, type, components, motion, budgets    |
| [SEO plan](docs/seo-plan.md)                                 | Metadata, structured data, content           |
| [Roadmap](docs/roadmap.md)                                   | Phases and acceptance criteria               |
| [Decisions](docs/adr/)                                       | Architecture decision records                |

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Drizzle on Neon Postgres · Better Auth · Stripe · Resend · Vercel (with cron jobs)

Quality: Vitest (unit, property and database tests) · Playwright with axe · Lighthouse CI · gitleaks secret scanning · GitHub Actions

## Getting started

Requires Node 24 (`nvm use` reads `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL is your own Neon branch
npm run db:migrate           # apply migrations to that branch
npm run seed                 # a demo league: 8 teams, invented players, a season half played, three past seasons
npm run dev
```

Environment variables are validated with Zod in [`src/lib/env.ts`](src/lib/env.ts) whenever Next loads its config, so `npm run dev`, `npm run build` and `npm start` stop immediately and name any variable that is missing or malformed. Server code reads them through `env` from `src/env.ts`, never `process.env` directly.

### Turning on Google sign-in

Sign-in works by email link out of the box. Google is added when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (one without the other is rejected at startup):

1. In Google Cloud Console, create an OAuth client ID of type **Web application**.
2. Add the authorized redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://kickball-league.vercel.app/api/auth/callback/google`.
3. Put both values in `.env.local`, and in Vercel with `npx vercel env add GOOGLE_CLIENT_ID --environment production` (and the same for the secret). Values go straight from your terminal to Vercel and are never committed.

### Run the database tests against a local Postgres

`npm run test:db` needs a real database, but not a Neon branch. With PostgreSQL installed locally (CI uses 18, the same major version as Neon; 16 passes too), one script creates a throwaway database matching CI's and applies every migration:

```bash
scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
npm run test:db
```

It starts the server if it is stopped, creates the `ci` role and `ci` database only when they are missing, and runs `npm run db:migrate`, so it is safe to run again after pulling new migrations. It connects as the `postgres` superuser (through `sudo` when you are not root); set `PG_SUPERUSER_URL` to connect another way, for example to a Postgres in Docker. Nothing here is a secret: the database is local and holds only test data.

### Demo mode

The demo deployment lets anyone view the league as a player, captain, ref or admin in one tap, with a banner on every page. It is off unless `DEMO_MODE=true` **and** the database's name contains `demo` **and**, on a Vercel production deployment, the project's address contains `demo`; see [ADR 0004](docs/adr/0004-demo-mode.md). To try it locally against a throwaway database:

```bash
PGDATABASE_NAME=kb_demo scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_demo DEMO_MODE=true
npm run demo:reset
npm run dev
```

The app talks to Neon through its HTTP and WebSocket drivers, and to a Postgres on `localhost` through node-postgres, so a local database works for `npm run dev` too.

### End-to-end and Lighthouse tests

`npm run test:e2e` builds the app and starts it twice: once as the league's site for the smoke tests, and once in demo mode for the core flows (registration with split pay up to Stripe Checkout, free-agent signup, generating and publishing a schedule, entering and confirming a score, a rain-out). Every key screen is checked with axe. It reseeds the database before each run and sends Stripe calls to [stripe-mock](https://github.com/stripe/stripe-mock), so it needs both running locally:

```bash
PGDATABASE_NAME=kb_e2e_demo scripts/setup-local-postgres.sh
docker run -d --rm -p 12111:12111 stripe/stripe-mock:v0.197.0
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_e2e_demo
npm run test:e2e
```

The database's name must contain `demo`, because the flows sign in with one-tap "view as". `npm run lighthouse` measures a production build (`npm run build` first) against the same seeded database, with the budgets in [design-system.md](docs/design-system.md#performance-budgets).

## Scripts

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | Start the development server                                     |
| `npm test`              | Run unit tests once                                              |
| `npm run test:coverage` | Run unit tests with coverage of `src/domain` and `src/lib`       |
| `npm run db:generate`   | Generate a SQL migration from `src/db/schema`                    |
| `npm run db:migrate`    | Apply pending migrations to `DATABASE_URL`                       |
| `npm run db:check`      | Check migration files are consistent                             |
| `npm run db:studio`     | Browse the database in Drizzle Studio                            |
| `npm run test:db`       | Database constraint tests (each rolls back)                      |
| `npm run seed`          | Replace the demo league with fresh seed data; refuses production |
| `npm run demo:reset`    | Reseed the demo deployment; refuses unless demo mode is on       |
| `npm run lint`          | ESLint, failing on any warning                                   |
| `npm run typecheck`     | Generate route types and run `tsc`                               |
| `npm run format:check`  | Check Prettier formatting                                        |
| `npm run build`         | Production build                                                 |
| `npm run test:e2e`      | Build, reseed, then smoke tests and core flows with axe          |
| `npm run lighthouse`    | Lighthouse budgets on the public pages of the last build         |

## How changes land

Every change starts as an issue sized to 30–60 minutes, gets its own branch (`<issue>-<slug>`) and reaches `main` through a pull request that is rebase-merged, so each small commit stays in the history. Several changes are often built at once, each in its own worktree; the rules that keep them from colliding are in [`AGENTS.md`](AGENTS.md#working-in-parallel). `main` is protected by the ruleset in [`.github/rulesets/main.json`](.github/rulesets/main.json): pull request required, CI must pass on an up-to-date branch, linear history, no force-pushes or deletion. To apply a change to it:

```bash
gh api -X PUT repos/michael-fesselmeyer/kickball-league/rulesets/<id> --input .github/rulesets/main.json
```

## Project layout

`src/domain/` holds pure TypeScript (the scheduler, standings, permissions, pricing) with no framework or database imports, enforced by a lint rule. That is where the interesting logic and most of the tests live. See [architecture](docs/architecture.md#code-layout).
