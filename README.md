# Kickball League

> Software to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, built first for a Brooklyn league of 8 to 12 teams.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) · **Status:** Phase 0, foundation (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md))

## Why this exists

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, and nobody can find the standings. This project replaces that patchwork with one site a player can use from their phone at the field.

The first deployment targets a real Brooklyn league that plays in McCarren Park: weeknight evenings in spring and fall, Sunday afternoons in summer. It is also a portfolio project, so the design decisions, tests and history are written to be read.

## Features

The build is under way; see the [roadmap](docs/roadmap.md) for what comes next.

- **Public schedule, team and game pages.** Anyone can see the season schedule (filter by team), each team's record, next game, results and roster (first name and last initial), and each game's time, field and score. Pages read only the published schedule version, never a draft.
- **Team calendar feeds.** Every team has an `.ics` feed that Apple Calendar, Google Calendar and Outlook can subscribe to. Times carry the league's time zone, and moved or rained-out games update in place.

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

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS v4 · Vitest · GitHub Actions

Planned in Phase 0: Drizzle on Neon Postgres, Better Auth, Playwright, Lighthouse CI, Vercel.

## Getting started

Requires Node 24 (`nvm use` reads `.nvmrc`).

```bash
npm install
cp .env.example .env.local   # fill in values; DATABASE_URL is your own Neon branch
npm run db:migrate           # apply migrations to that branch
npm run seed                 # a demo league: 8 teams, invented players, a season half played
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

## How changes land

Every change starts as an issue sized to 30–60 minutes, gets its own branch (`<issue>-<slug>`) and reaches `main` through a pull request that is rebase-merged, so each small commit stays in the history. `main` is protected by the ruleset in [`.github/rulesets/main.json`](.github/rulesets/main.json): pull request required, CI must pass on an up-to-date branch, linear history, no force-pushes or deletion. To apply a change to it:

```bash
gh api -X PUT repos/michael-fesselmeyer/kickball-league/rulesets/<id> --input .github/rulesets/main.json
```

## Project layout

`src/domain/` holds pure TypeScript (the scheduler, standings, permissions, pricing) with no framework or database imports, enforced by a lint rule. That is where the interesting logic and most of the tests live. See [architecture](docs/architecture.md#code-layout).
