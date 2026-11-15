# Development guide

Setup beyond the README's quick start: turning on the optional integrations, running the database and end-to-end tests locally, and how changes reach `main`.

## Turning on Google sign-in

Sign-in works by email link out of the box. Google is added when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set (one without the other is rejected at startup):

1. In Google Cloud Console, create an OAuth client ID of type **Web application**.
2. Add the authorized redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://kickball-league.vercel.app/api/auth/callback/google`.
3. Put both values in `.env.local`, and in Vercel with `npx vercel env add GOOGLE_CLIENT_ID --environment production` (and the same for the secret). Values go straight from your terminal to Vercel and are never committed.

## Turning on web push

Push is off until the league has a VAPID key pair. Generate one into `.env.local` (it prints only the public key):

```bash
npm run push:keys
```

For hosting, copy `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from `.env.local` into the provider's encrypted settings. `VAPID_SUBJECT` (a `mailto:` address or `https://` URL push services can contact) is optional and defaults to the site's address. Keep the same pair once players have opted in: a new pair means every device has to opt in again. Push needs the service worker, which only production builds register, so try it with `npm run build && npm start`.

## Turning on the Instagram connection

The photo sync is off until both `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are set. Like `DEMO_MODE`, they are read straight from the server's environment and checked where they are used, not in `src/lib/env.ts` or `.env.example`: one without the other, or a malformed value, leaves the connection off, and the server log and the Instagram admin screen name the variable to fix.

1. In Meta's developer dashboard, create an app with the **Instagram API with Instagram Login** product, and add the league's Instagram professional (Business or Creator) account to the app's roles. An app used only by its own account needs no App Review.
2. Add the redirect URI `<site address>/app/admin/instagram/callback`, for example `http://localhost:3000/app/admin/instagram/callback`.
3. Put the Instagram app ID and secret in `.env.local`, and in Vercel's encrypted settings for production. Then an admin chooses **Connect Instagram** on the Instagram admin screen.

To try the whole flow without an account, start the development server with `INSTAGRAM_FIXTURE=true` and no app ID: connecting and syncing then play back a recorded copy of the API (`src/services/fixtures/instagram`) with generated pictures. A production build ignores it unless demo mode is on.

## Email quota

The outbox keeps email inside the provider's free plan. It assumes Resend's free limits, 100 emails a UTC day and 3,000 a month, and keeps 10 of each back for sign-in links. Different limits can be set with the optional `EMAIL_DAILY_LIMIT`, `EMAIL_MONTHLY_LIMIT` and `EMAIL_RESERVE` (whole numbers), read straight from the environment like `DEMO_MODE`. What happens when the quota runs out is in [docs/architecture.md](architecture.md), section 5, "The email budget".

## Run the database tests against a local Postgres

`npm run test:db` needs a real database, but not a Neon branch. With PostgreSQL installed locally (CI uses 18, the same major version as Neon; 16 passes too), one script creates a throwaway database matching CI's and applies every migration:

```bash
scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
npm run test:db
```

It starts the server if it is stopped, creates the `ci` role and `ci` database only when they are missing, and runs `npm run db:migrate`, so it is safe to run again after pulling new migrations. It connects as the `postgres` superuser (through `sudo` when you are not root); set `PG_SUPERUSER_URL` to connect another way, for example to a Postgres in Docker. Nothing here is a secret: the database is local and holds only test data.

## Demo mode

The demo deployment lets anyone view the league as a player, captain, ref or admin in one tap, with a banner on every page. It is off unless `DEMO_MODE=true` **and** the database's name contains `demo` **and**, on a Vercel production deployment, the project's address contains `demo`; see [ADR 0004](adr/0004-demo-mode.md). To try it locally against a throwaway database:

```bash
PGDATABASE_NAME=kb_demo scripts/setup-local-postgres.sh
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_demo DEMO_MODE=true
npm run demo:reset
npm run dev
```

The app talks to Neon through its HTTP and WebSocket drivers, and to a Postgres on `localhost` through node-postgres, so a local database works for `npm run dev` too.

## End-to-end and Lighthouse tests

`npm run test:e2e` builds the app and starts it twice: once as the league's site for the smoke tests, and once in demo mode for the flows, which reach every signed-in screen (the list is in [architecture](architecture.md#end-to-end-coverage)). One of them walks a whole season: an admin sets up a season and its fields, a captain registers a team with split pay and pays through a signed Stripe webhook, a player joins by invite and pays their share, a free agent is placed on a new team, the schedule is published, a sub picks up a spot, a score is confirmed and counted in the standings, and a rain-out notice goes out. One journey per role (player, captain, ref, admin, owner and operator) walks that role's work across features, with people made up for it. Every key screen is checked with axe, and screens no flow visits are also checked in the dark theme and at a phone width. `npm run test:e2e:site-wide` then runs the operator's read-only, paused and feature switches on their own, since they change the site for every other test. `npm run test:e2e` seeds the database before building, so the public season and team pages are prerendered as in production and the flows check that their actions refresh them. Both reseed the database before the tests and send Stripe calls to [stripe-mock](https://github.com/stripe/stripe-mock), so they need both running locally:

```bash
PGDATABASE_NAME=kb_e2e_demo scripts/setup-local-postgres.sh
docker run -d --rm -p 12111:12111 stripe/stripe-mock:v0.197.0
export DATABASE_URL=postgresql://ci:ci@localhost:5432/kb_e2e_demo
npm run test:e2e
# Reuses the build the first command made.
E2E_PREBUILT=true npm run test:e2e:site-wide
```

The database's name must contain `demo`, because the flows sign in with one-tap "view as". To run beside another checkout's tests on the same machine, set `E2E_SMOKE_PORT` and `E2E_FLOWS_PORT` (3100 and 3110 by default). `npm run lighthouse` measures a production build (`npm run build` first) against the same seeded database, with the budgets in [design-system.md](design-system.md#performance-budgets). It starts the server on port 3200 and warms every page before the first measurement.

In CI, the end-to-end and Lighthouse checks each build the app once and share that build across their shards: Playwright runs on four shards, the smoke tests on one and the flows split across three (`E2E_PREBUILT=true` starts the existing build instead of building again), and Lighthouse's pages are split across eight runners, balanced by how long each page takes to measure (`node scripts/lighthouse-shard.mjs <shard> 8` writes one shard's config, with the same five runs and budgets). A pull request that changes only Markdown or `docs/` skips that work and still reports every required check as passed. The layout is in [architecture](architecture.md#11-continuous-integration).

## How changes land

Every change starts as an issue sized to 30–60 minutes, gets its own branch (`<issue>-<slug>`) and reaches `main` through a pull request that is rebase-merged, so each small commit stays in the history. Several changes are often built at once, each in its own worktree; the rules that keep them from colliding are in [`AGENTS.md`](../AGENTS.md#working-in-parallel). `main` is protected by the ruleset in [`.github/rulesets/main.json`](../.github/rulesets/main.json): pull request required, CI must pass on an up-to-date branch, linear history, no force-pushes or deletion. To apply a change to it:

```bash
gh api -X PUT repos/michael-fesselmeyer/kickball-league/rulesets/<id> --input .github/rulesets/main.json
```
