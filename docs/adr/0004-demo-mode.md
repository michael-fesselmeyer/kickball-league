# ADR 0004: Demo mode with one-tap "view as", locked out of production

- Status: accepted
- Date: 2026-11-12

## Context

The demo deployment is how the league's owners and visitors see the product. Every role (player, captain, ref, admin) has to be explorable in one tap, without signing up, a password or an email link. The same code runs the league's real site, where a way to sign in as someone without credentials would be a serious hole. The repository is public, so the design has to be safe even for someone who reads every line of it.

## Decision

**One server-side switch, checked on every use.** `demoStatus(env)` in `src/lib/demo/guard.ts` is a pure function of the server's environment. Demo mode is on only when all of these hold, and off otherwise:

1. `DEMO_MODE` is exactly `true`. It has no `NEXT_PUBLIC_` prefix, so it never reaches a browser bundle, and no request, cookie or header can set it.
2. The database's name (the path of `DATABASE_URL`) contains `demo`. The production database is not named that way, so pointing the demo deployment at it turns demo mode off.
3. On a Vercel production deployment, the project's production address (`VERCEL_PROJECT_PRODUCTION_URL`, set by Vercel) contains `demo`. The league's own project can never run demo mode, even if `DEMO_MODE` is set there by mistake.
4. Stripe is not in live mode.

A refused `DEMO_MODE=true` fails safe: the site runs normally and the server log says which check refused it.

**View-as is a server-only auth endpoint.** A small Better Auth plugin (`src/lib/auth/demo-view-as.ts`) adds `/demo/view-as`, marked `SERVER_ONLY`, so Better Auth's HTTP router never exposes it. The only way in is the `viewAs` Server Action behind the banner's buttons, which Next.js protects with its origin check. Both the action and the endpoint check `demoStatus` before doing anything, so with demo mode off nothing is looked up and no session is created. The visitor picks a persona by key (`player`, `captain`, `ref`, `admin`), never by id or email, and the endpoint only signs in to an account on that persona's fixed `example.test` address. Sessions are ordinary Better Auth sessions created through its internal adapter, expire after four hours and end with the browser, so every permission check in the app applies unchanged.

**Personas are seed data.** `src/seed/demo-personas.ts` adds Pat Player and Casey Captain to the first team (Casey takes over as captain), Reese Ref with games to referee, and Addie Admin. They have fixed ids and are rebuilt by every seed.

**The reset is the seed, behind the same guard.** `npm run demo:reset` (`scripts/reset-demo.ts`) refuses with exit code 1, before connecting to anything, unless `demoStatus` is on, then runs the seed. The seed replaces only seed-owned rows in one transaction, so a run that fails or overlaps another leaves the previous data in place, and running it twice is the same as once.

## Alternatives considered

- **Better Auth's admin plugin and its impersonation.** It needs a signed-in admin first and adds role columns to the auth tables, which is a schema change for a demo-only feature.
- **Shared demo passwords or pre-made magic links.** They are credentials in a public repository, and the product deliberately has no passwords.
- **A cookie or query parameter that turns demo mode on.** Anything a browser can send, an attacker can send.
- **Trusting `DEMO_MODE` alone.** One wrong environment variable in the league's project would open every account; the database and deployment checks make that mistake harmless.

## Consequences

- The demo needs its own database whose name contains `demo` (for example `kickball_demo` on the Neon `demo` branch), and its Vercel project's production address must contain `demo`.
- `DEMO_MODE` and the Vercel variables are read from the raw environment by the guard rather than through the validated `env` object, because the check combines variables the schema does not own.
- Tests cover the guard, the endpoint inside a real Better Auth instance (unreachable over HTTP, refused with demo mode off), the banner, the persona rows and the reset script itself, which is run with demo mode off and must exit before connecting.
