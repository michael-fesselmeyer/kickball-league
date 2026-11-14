# Uptime and error alerts on free tiers

How the league learns that the site is down, that something is failing, or that a free limit is close, before players say so. Free tiers only ([ADR 0021](../adr/0021-free-services-only.md)), checked against each provider's own page on 2026-11-14. None of these has a card on file, so none can bill.

## What exists today

- **In the app:** the outbox retries failed messages and keeps email within Resend's free quota, and admins hear when urgent email has to wait ([architecture.md](../architecture.md), section 5). Stripe webhooks are recorded once each, and a failure returns 500 so Stripe retries (section 6).
- **Not built yet:** Sentry, a `/api/health` route, and the per-job heartbeat and admin health card in [architecture.md](../architecture.md), section 12. Those rows are plans, and the follow-ups at the end of this page cover them.

## The trap: don't keep the database awake

Neon Free gives 100 CU-hours of compute a month, and scales the database to zero after 5 minutes idle ([Neon plans](https://neon.com/docs/introduction/plans)). An uptime check that queries the database every 5 minutes keeps it awake around the clock: 720 hours × 0.25 CU = **180 CU-hours, nearly twice the free month**. Neon would then suspend the database until the next month.

**Today every page request reaches the database**, public pages included. Their HTML is static, but `src/proxy.ts` runs first on every page (for the operator's "paused" notice) and reads the site's status from Postgres, cached for only 5 seconds per server instance (`currentSite` in `src/lib/platform/site.ts`). Paths with a dot in them, such as `/robots.txt`, skip the proxy and don't touch the database.

So:

- **The frequent check uses `/robots.txt`.** It proves the deployment and the CDN answer, every 5 minutes, without waking the database.
- **A page check runs hourly.** Each one can wake the database for at least 5 minutes: 24 × 30 × 5 minutes × 0.25 CU ≈ **15 CU-hours a month** at worst, and less when real traffic already has it awake. It also proves that pages render and the database answers.
- Once the proxy reads the site status without a query per request (a follow-up below), the home page can move to every 5 minutes.
- Never put the live-score route or a signed-in page on a monitor.

## The plan

| Layer | Service and free limit (source) | What it watches | Who is alerted | Needs code? |
|---|---|---|---|---|
| **Uptime** | **UptimeRobot Free**: 50 monitors, 5-minute interval, email alerts, 1 status page, 3 months of history. "Good for personal and commercial projects" ([pricing](https://uptimerobot.com/pricing/)); "available for any use, including commercial and business use" ([terms](https://uptimerobot.com/terms/), section 3) | `https://<league domain>/robots.txt` every 5 minutes, and the home page every 60 minutes, each alerting after 2 failures. Optional: a public status page | The maintainer and one owner by email | No |
| **Errors** | **Sentry Developer**: 1 user, 5,000 errors a month, email alerts only, 30-day lookback, 1 uptime monitor, 1 cron monitor ([pricing](https://sentry.io/pricing/)). Over quota, events "will not be accepted" ([quotas](https://docs.sentry.io/pricing/quotas/)) | Server and browser errors, with the release and the person's role, never their name or email. Alert on a new issue and on more than 10 events of one issue in an hour | The maintainer only: one user | **Yes**: install `@sentry/nextjs` with a DSN (not a secret) |
| **Scheduled jobs** | **Healthchecks.io Hobbyist**: 20 checks, 100 log entries a check ([pricing](https://healthchecks.io/pricing/)). Or Sentry's one cron monitor for the outbox alone | Each of the 11 jobs pings its own check URL when it finishes; a check alerts when its ping is more than 2 hours late (Vercel runs a daily job within ±59 minutes) | The maintainer and one owner by email | **Yes**: a fetch at the end of each job route. Each check URL is a secret |
| **Database health** | Included in UptimeRobot above | Today, the hourly home-page check. Later, `/api/health` hourly in its place | As uptime | Later: the route itself |
| **Payments** | Stripe's dashboard, included | Workbench → Webhooks: failed deliveries to `/api/stripe/webhook`. Disputes appear in the dashboard and in the account's email | The league's Stripe account holders | No |
| **Email delivery** | Resend Free's dashboard, included | Bounces and complaints. DMARC reports at the `rua` address from the [runbook](runbook.md), step 4 | The maintainer | No |
| **Backup** | **GitHub Actions**, free on a public repository; at least every 5 minutes, possibly delayed at busy times, switched off after 60 days without repository activity ([GitHub: schedule](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)) | A second, independent check of `/robots.txt` every 30 minutes, in case UptimeRobot itself is down | Whoever last changed the workflow's schedule, by GitHub's failure email | **Yes**: a small workflow, with no secrets |

**Not recommended:**

- **Better Stack's free tier** is labeled "Free for personal projects" ([pricing](https://betterstack.com/pricing)), so it doesn't suit a league that takes payments.
- **Cronitor's free Hacker plan** has only 5 monitors ([pricing](https://cronitor.io/pricing)), fewer than the 11 jobs.

**To check before relying on Sentry:** its [terms](https://sentry.io/terms/), section 17, limit "No-Charge Products" to a period Sentry designates, 30 days by default. Whether the Developer plan counts as one isn't stated. If it does, errors go to the GitHub Actions failure email and the app's own admin screens instead.

## Free limits that need a weekly look

None of these sends an alert on its free plan, so in season an admin checks them each week ([architecture.md](../architecture.md), section 15):

| Limit | Where to look | Act when |
|---|---|---|
| Vercel Hobby: 1,000,000 CDN requests and function invocations, 4 hours of Active CPU a month ([Hobby plan](https://vercel.com/docs/plans/hobby)) | Vercel → Usage | Past 60% before the 20th of the month |
| Neon Free: 100 CU-hours, 5 GB of transfer, 1 GB of storage ([Neon plans](https://neon.com/docs/introduction/plans)) | Neon console → Usage | Past 60 CU-hours before the 20th, or past 700 MB stored |
| Resend Free: 100 emails a day, 3,000 a month ([Resend pricing](https://resend.com/pricing)) | Resend dashboard, and the app's own notice to admins when urgent email waits | Past 2,000 in a month |
| Sentry Developer: 5,000 errors a month | Sentry → Stats | Past 2,500: find the noisy error and fix or group it |

## Setting it up

1. **UptimeRobot** (no code). The maintainer creates the free account, which is theirs to create. Add the two HTTP(s) monitors from the table, alerting the maintainer's and one owner's email.
   - **Test:** add a third monitor on a path that doesn't exist (it answers 404). Its alert email should arrive within about 10 minutes. Then delete it. Pausing the site from the operator console is no test: paused pages still answer `200`.
2. **Follow-up issues** for the parts that need code, each a small pull request:
   - Sentry for Next.js, with personal data scrubbed (role only), browser errors sampled, and a release tag per deploy.
   - Job heartbeats: one optional check URL per job from the environment, pinged after a successful run. Off when unset.
   - `/api/health`: one `select 1`, no personal data, and a note that it is checked at most hourly.
   - The proxy's site-status read: cache it so a public page view doesn't query Postgres (for example `use cache` with a tag the operator console expires). This also makes [architecture.md](../architecture.md), section 15, true again where it says public pages don't wake the database.
   - A scheduled GitHub Actions workflow that fetches `/robots.txt` and fails on a non-200.
3. **After each is set up,** make it fire once on purpose, and record in the launch log that the alert arrived.
