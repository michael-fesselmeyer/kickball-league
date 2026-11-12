# Kickball League

> Software to run a recreational adult kickball league: registration and payment, waivers, a fair season schedule, game-day scores and rain-outs, built first for a Brooklyn league of 8 to 12 teams.

**Live:** [kickball-league.vercel.app](https://kickball-league.vercel.app) · **Status:** Phase 0, foundation (free-tier hosting, see [ADR 0003](docs/adr/0003-free-hosting-and-secrets.md))

## Why this exists

Adult rec leagues run on a patchwork: a registration form, a payment link, a PDF rulebook, a spreadsheet schedule and a group chat. Captains chase teammates for money, admins rebuild the schedule by hand every time it rains, and nobody can find the standings. This project replaces that patchwork with one site a player can use from their phone at the field.

The first deployment targets a real Brooklyn league that plays in McCarren Park: weeknight evenings in spring and fall, Sunday afternoons in summer. It is also a portfolio project, so the design decisions, tests and history are written to be read.

## Features

None yet. The design is complete and the build has started; see the [roadmap](docs/roadmap.md).

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
