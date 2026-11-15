# ADR 0052: The local demo runs offline, with stand-ins only where the network would be

- Status: accepted
- Date: 2026-11-14

## Context

The league's owners see the app at a meeting, from one laptop. A hosted demo needs accounts, a network and someone to keep it up; a meeting room may have poor Wi-Fi. The demo has to show everything that saves the owners time: payments, the emails people get, the weather that drives rain-outs and a game being scored live. All of that normally reaches outside services (Stripe, the email provider, the National Weather Service, Instagram), and none of those may cost money or need a key ([ADR 0021](0021-free-services-only.md)).

## Decision

**`npm run demo` runs the real app, built for production, in demo mode on the laptop** ([ADR 0004](0004-demo-mode.md)). It finds Postgres (its own Docker container, or a local Homebrew server), recreates a `kb_demo` database, migrates it, runs `npm run demo:reset`, builds (or reuses today's build) and starts the app on a free port. Only the four services that need a network are swapped, each behind a switch that only the demo sets and that is refused outside demo mode:

- **Payments: stripe-mock and a local checkout page** (`DEMO_CHECKOUT`). stripe-mock answers the API, but it has no page to pay on and never calls back. Checkout instead sends people to `/app/demo/checkout/[session]`, which shows what is being paid for and, on "Pay", signs a `checkout.session.completed` event with the demo's own webhook secret and hands it to the webhook route. The route checks the signature and marks the purchase paid exactly as it does for Stripe, so the receipt, the roster and the books all update through the real path. Without stripe-mock, payments are off and the payment screen says it is a demo.
- **Email: the outbox.** The demo has no email provider, so every notice stays in the outbox, as it does on any server without one. An admin-only **Demo mail** page renders them as each person would get them. It is a 404 outside demo mode, where real people's mail is nobody's to browse.
- **Weather: a recorded pattern** (`WEATHER_FIXTURE`): dry tonight, showers over the next game day.
- **Instagram: its recorded fixture** (`INSTAGRAM_FIXTURE`, already used by the tests).

**The demo looks like a game night.** After the seed, `demo:reset` moves the next round to tonight with its first game live and a few innings entered, and runs the league's own rain alert and reminder jobs so the mail has something in it.

**The demo never sees the league's keys.** Its processes start from an empty environment (only `PATH`, `HOME` and the like pass through), with `.env.local` loading switched off, and get throwaway secrets made on the first run and kept in the git-ignored `.demo/` folder.

**Reset from the banner.** Admins get a two-step "Reset demo" in the banner, where the code is checked out (the local demo). It runs the same `npm run demo:reset` and drops every cached page. The banner asks from the browser whether the viewer is an admin, because it sits on static public pages that never read who is signed in.

## Alternatives considered

- **A hosted demo for the meeting.** It needs accounts and a network, and anything shown depends on the room's Wi-Fi.
- **Stripe's test mode.** Free, but it needs a Stripe account, keys and the internet, and its webhooks need a public address or the Stripe CLI.
- **Marking purchases paid directly in the database.** Simpler, but it would skip the webhook path the league's money depends on, so the demo would not show what really happens.
- **Running the development server.** Slower pages and a different rendering path from what players get; the production build is what the league would run.

## Consequences

- The first run needs the internet once (packages, Docker images, fonts); later runs on the same day start in seconds and work offline.
- Each stand-in is one more switch to keep refused outside demo mode; each has a test that it stays off on the league's own site.
- Saving a card for a team's guarantee (Checkout's setup mode) is skipped in the demo: its page says so.
- The demo's dates follow today once the seed moves the season forward on each reset (issue 317); until then the live round is tonight but later rounds keep their seeded dates.
