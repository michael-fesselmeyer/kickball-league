# ADR 0007: End-to-end tests on a local Postgres and Stripe's mock server

- Status: accepted
- Date: 2026-11-12

## Context

The core flows (registration and checkout, scheduling, scores, rain-outs) need end-to-end tests that run on every pull request, against a seeded database, in under ten minutes. Two things stood in the way:

1. The app reaches its database only through Neon's HTTP and WebSocket drivers. They talk to Neon's proxy, which a plain Postgres does not have, so the app could not run against the Postgres service container CI already uses for migrations, or against a Postgres in Docker on a laptop.
2. Checkout calls Stripe. CI has no Stripe keys, and a test should not depend on Stripe's servers or create objects in a real account.

## Decision

**node-postgres for a database on this machine.** `src/db/client.ts` keeps Neon's drivers for every Neon URL and uses `drizzle-orm/node-postgres` when `DATABASE_URL` points at `localhost`, `127.0.0.1` or `[::1]` (`src/db/local.ts`). Drizzle's query builder is the same over both drivers; only the declared type differs, so the local clients are typed as the Neon ones. Production and preview deployments always use a Neon URL, so they never take this path.

**Each CI job gets its own seeded database.** The End-to-end job starts Postgres 18 as a service container, applies the migrations, and Playwright's global setup runs the seed before every run, so a run never depends on what the previous one left behind. The flows change data, so they are not retried.

**Two servers from one build.** The smoke tests run against the league's site as it ships, with demo mode off. The flows run against a second `next start` with demo mode on (its database name contains `demo`), so each role signs in with the one-tap "view as" from [ADR 0004](0004-demo-mode.md) instead of an email link.

**stripe-mock for checkout.** Stripe publishes [stripe-mock](https://github.com/stripe/stripe-mock), a server that answers the real API with valid fixtures. CI runs it as a second service container. `STRIPE_MOCK_URL` points the Stripe SDK at it (`src/services/stripe-mock.ts`), and is ignored unless the key is a test key and the address is plain HTTP on this machine, so it can never redirect live payments. Like `DEMO_MODE`, it is read from the raw environment because it is a test switch, not an app setting. The test stops at the redirect to `checkout.stripe.com`; the webhook that marks a payment paid is covered by unit tests.

## Alternatives considered

- **A Neon branch per CI run.** The real driver end to end, but it needs a Neon API key in CI, depends on Neon being reachable, and adds branch creation and cleanup to every run.
- **Neon's local proxy in Docker.** Keeps the Neon driver locally, but adds a third-party image and driver configuration for a proxy that only exists in tests.
- **Stopping before checkout.** Without Stripe the Pay button is hidden, so the test would never press it or exercise the code that builds the checkout session.

## Consequences

- Local development can use a Postgres in Docker instead of a personal Neon branch.
- The Neon-specific driver behaviour (HTTP for single statements, WebSocket for transactions) is not exercised by the end-to-end tests. It stays covered by the preview deployment, which runs on a Neon branch.
- `pg` moves from a development dependency to a runtime one. Next.js keeps it out of the bundle and loads it from `node_modules`; on Neon it is imported but never connects.
- node-postgres warns when one transaction runs queries concurrently. The warning is harmless today and points at code worth tidying before pg 9.
