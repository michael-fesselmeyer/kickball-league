# ADR 0009: A platform operator above the league's owners

- Status: accepted
- Date: 2026-11-12

## Context

The league's owners run the league: seasons, teams, money and their admins. Someone also runs the platform itself, the hosting, the database and the software. That role needs a few powers the owners don't have: changing who the owners are, freezing or pausing the site, switching features off, and getting all the league's data out. It also needs to be impossible to take away from inside the app, or one owner could lock everyone else out, including the people who keep the site running.

## Decision

**Identity comes from the server's environment, not the database.** `OPERATOR_USER_IDS` lists the operator's account ids, comma-separated. It is read straight from the environment, like `DEMO_MODE` (ADR 0004), because it is optional, holds no secret and is never part of a build. No table stores it, so no screen, API, import or SQL run through the app can grant, remove or see past it. Empty means there is no operator.

**The operator console** is at `/operator`. It returns 404 to everyone else, signed out or not, so it doesn't reveal that it exists. Changes need a sign-in from the last 15 minutes; an older session sees the console read-only, with a link to sign in again.

From the console the operator can:

- make a person a player, an admin or an owner (owners can't change the operator, who isn't a database role);
- set the site status: **active**; **read-only** (everything visible, nothing changes); or **paused** (public pages show a neutral notice);
- switch features off and on: the sub finder, announcements, and weather;
- download the whole league as JSON.

**Enforcement is on the server.**

- Every Server Action goes through `requirePermission` or `requireSelf`. While the site is read-only or paused, those stop any Server Action from anyone but the operator before it changes anything, and send the person to `/paused`. Reading pages is unaffected.
- Scheduled jobs (`/api/jobs/*`) skip their run while the site is read-only or paused, so nothing is sent or changed in the background.
- While paused, the proxy shows public pages the `/paused` notice. Signing in, the signed-in app and the operator console stay reachable.
- Stripe webhooks keep working in every status, so a payment already made is still recorded.
- A switched-off feature's pages and actions return 404, and the weather chip and rain alerts stop.

**Owners keep transparency and their data.** Every operator action writes an audit row (`operator.*`), and every export writes one too. Owners can download the same league export from their admin home at any time, paused or not, so the league's data is never held back.

## Consequences

- Changing the operator means changing an environment variable and redeploying, which only whoever controls the hosting can do. That is the point.
- The site status is cached in memory for five seconds per server instance, so a change reaches other instances within seconds.
- Not built yet: a read-only "view as" any person for support, and an audit log page for owners. Both are follow-up issues.

## Alternatives considered

- **A `super_admin` database role.** Simple, but anyone who can write to the profile table (an owner's mistake, an import, a bug) could grant or remove it.
- **Hiding the console behind an unlisted URL alone.** Security through obscurity; the 404 is a courtesy here, not the protection.
