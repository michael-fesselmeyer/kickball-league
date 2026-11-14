# Hosting decision brief

Which free host should serve the live league, now that it takes registration fees? This brief answers [open question 51](../open-questions.md). It updates [architecture.md](../architecture.md), section 15, "Hosting and commercial use", with each provider's pages as read on **2026-11-14**. Nothing here needs a sign-up, and the brief doesn't recommend anything that costs money ([ADR 0021](../adr/0021-free-services-only.md)).

## The question

The site takes money for the league through Stripe's hosted Checkout: registration fees, event tickets and merch. The card is typed on Stripe's page, never on ours. Any host must:

1. allow a site like that on its free plan, by its own terms;
2. stay free: at a limit it stops or pauses and never bills, with no card on file ([ADR 0003](../adr/0003-free-hosting-and-secrets.md));
3. run what the app uses today: Next.js 16 with Cache Components, `after()`, the `proxy.ts` middleware, Server Actions with 4 MB uploads, `next/og` share images, `sharp` on the server (books, member photos, Instagram copies, friend-league logos), Neon's HTTP and WebSocket drivers, and 11 scheduled jobs that call `/api/jobs/*` with `Authorization: Bearer $CRON_SECRET`.

## What the app depends on that is Vercel's

Moving host means changing these, and nothing else in the code:

| Where | What it uses | On another host |
|---|---|---|
| `vercel.json` | 11 daily cron entries and `git.deploymentEnabled: false` | Recreate the schedule another way (see each option) |
| `src/lib/env.ts` (`withVercelDefaults`) | Builds `BETTER_AUTH_URL` from `VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_BRANCH_URL` and `VERCEL_URL` when it is unset | Set `BETTER_AUTH_URL` explicitly. Previews need their own address set per deploy, or no sign-in on previews |
| `src/lib/site.ts` (`isIndexable`) | Lets search engines in only when `VERCEL_ENV` is `production` | **Must change**, or production is served with `noindex` and drops out of search. A host-neutral variable (for example `SITE_ENV=production`) fixes it |
| `src/lib/demo/guard.ts`, `src/seed/guard.ts` | `VERCEL_ENV` and the production address are among the demo and seed guards | Keep the guards working with the same host-neutral variable; the database-name and Stripe-live checks still hold on their own |
| `next.config.ts` | `bodySizeLimit: "4mb"`, sized under Vercel's 4.5 MB request limit | Check the new host's request-body limit |

## The options

### 1. Vercel Hobby (today's setup)

- **Terms.** "You shall only use the Services under a Hobby plan for your personal or non-commercial use" ([Terms of Service](https://vercel.com/legal/terms), section 4, dated 2026-10-19). Neither the terms nor the [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) define commercial use. Section 4 also lets Vercel shut down Hobby projects without notice, and section 3 says Hobby content may be used for AI model training by default.
- **Free limits.** Each month includes 1,000,000 function invocations, 4 hours of Active CPU, 360 GB-hours of memory, 1,000,000 CDN requests, 100 GB of fast data transfer, 10 GB of origin transfer and 5,000 image transformations. Over a limit you "will have to wait until 30 days have passed" ([Hobby plan](https://vercel.com/docs/plans/hobby)). Nothing is billed.
- **Scheduled jobs.** Up to 100 per project, each at most once a day, run any time within the scheduled hour (±59 minutes) ([Cron Jobs usage](https://vercel.com/docs/cron-jobs/usage-and-pricing)). The app's 11 daily jobs fit. Sends happen right away through `after()`, so the daily outbox sweep only catches retries.
- **Changes needed.** None. Turn deployments back on (runbook step 9).
- **Fit.** The best technical fit by far. The risk is the terms: a site that collects registration fees may well be "commercial", and it is Vercel's call.

### 2. Cloudflare Workers Free, with the OpenNext adapter

- **Terms.** The [self-serve subscription agreement](https://www.cloudflare.com/terms/) (updated 2025-09-12) has no non-commercial clause. Section 2.2.1(h), though, bars processing or collecting credit card information "on any web property that is receiving Free Services". The app never sees a card: players pay on Stripe's hosted Checkout, and the captain guarantee saves its card there too. The league should still have that reading confirmed before relying on it.
- **Free limits.** 100,000 requests a day (Error 1027 over it), **10 ms of CPU time per request**, 128 MB of memory, 50 subrequests per request, 5 Cron Triggers per account, and a 64 MiB uncompressed Worker ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/), updated 2026-11-13). [OpenNext's Cloudflare page](https://opennext.js.org/cloudflare) still says 3 MiB on the free plan; Cloudflare's own page is the one to trust, but a trial build settles it.
- **Next.js support.** OpenNext supports every minor of Next.js 16, `after()`, `'use cache'`, PPR and ISR. Node middleware (`proxy.ts`) is experimental, and image optimization needs Cloudflare Images set up ([OpenNext for Cloudflare](https://opennext.js.org/cloudflare)).
- **Changes needed.**
  - Add `@opennextjs/cloudflare` and `wrangler`, a `wrangler.jsonc` with `nodejs_compat`, an `open-next.config.ts`, and build and deploy scripts. Deploy from a GitHub Actions workflow with a Cloudflare API token kept as a repository secret.
  - **Replace `sharp`.** It is a native module and does not run in Workers. Four upload paths shrink or check images with it on the server (`src/lib/books/store-file.ts`, `src/lib/member-photos/process-photo.ts`, `src/lib/social/compress-photo.ts`, `src/lib/friends/compress-logo.ts`). Each needs a WebAssembly image library or an image service.
  - **Images.** Turn off `next/image` optimization for the stored photos, which are already small, or set up Cloudflare Images within its free allowance.
  - **Scheduled jobs.** Fold the 11 jobs into at most 5 Cron Triggers: a scheduled handler that calls the job routes with the bearer secret. Alternatively, a scheduled GitHub Actions workflow can call them for free in a public repository, at most every 5 minutes, possibly delayed at busy times, and switched off after 60 days without repository activity ([GitHub: schedule](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule)).
  - The host-neutral `VERCEL_*` replacements from the table above.
- **Fit.** The terms suit the league best of the three, but it needs the most work, and **10 ms of CPU** is tight for rendering signed-in pages, verifying Stripe webhooks and encrypting web pushes. Only a trial build can show whether it fits. `wrangler dev` runs the build on this machine without an account.

### 3. Netlify Free

- **Terms.** The [terms of use](https://www.netlify.com/legal/terms-of-use/) defer to the [self-serve subscription agreement](https://www.netlify.com/pdf/self-serve-subscription-agreement.pdf), a PDF that could not be read as text for this brief. **The maintainer has to read it** for any limit on commercial use of the free plan, and for what happens when credits run out.
- **Free limits.** "$0 forever" with 300 credits a month. A production deploy costs 15 credits, compute 10 credits a GB-hour, bandwidth 20 credits a GB, and web requests 2 credits per 10,000 ([Netlify pricing](https://www.netlify.com/pricing/)). That is **at most 20 production deploys a month** even with no traffic, and every merge to `main` would be one. The pricing page doesn't say whether a site pauses or is billed at the limit.
- **Next.js support.** Netlify's adapter lists full support for Cache Components, `next/after` and middleware ([Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)). Functions run on Node, so `sharp` works. Next.js 16 isn't named on that page.
- **Changes needed.** The host-neutral `VERCEL_*` replacements; the scheduled jobs as Netlify scheduled functions (whether the free plan includes them wasn't confirmed) or the GitHub Actions workflow above; and production deploys batched by hand instead of one per merge.
- **Fit.** Technically closer to Vercel than Cloudflare, but the terms are unread and the credit budget leaves little room for deploys.

### Ruled out

- **Render Free.** Render says of free instances: "Do not use them for production applications". They sleep after 15 minutes idle and take about a minute to wake, and free Postgres expires after 30 days ([Render free instances](https://render.com/docs/free)).
- **Any plan that needs a card on file.** It breaks the "stops, never bills" rule in ADR 0003, and a paid plan is the maintainer's call alone (ADR 0021).

## Recommendation

1. **Ask Vercel first, in writing**, through its support or contact form: does a volunteer-run adult rec league's site that collects registration fees through Stripe fit the Hobby plan? This needs no new account; the maintainer asks from the existing one. If Vercel says yes in writing, keep the answer with the launch records and stay. Nothing in the repository changes.
2. **Make the code host-neutral now, either way.** It costs little and removes the worst trap (production marked `noindex`): add a `SITE_ENV` (or similar) variable for "this is the league's production site", use it in `isIndexable` and the guards, and set `BETTER_AUTH_URL` explicitly in production. That is a small follow-up issue.
3. **If Vercel says no, or doesn't answer within two weeks of launch:** read Netlify's subscription agreement. If it allows the league on the free plan, and pauses rather than bills at 300 credits, Netlify needs the least code change. Otherwise, run a local Cloudflare trial build (`opennextjs-cloudflare build`, then `wrangler dev`): measure CPU on the home page, a signed-in team page, a Stripe webhook and a push send. Move only if all of them stay under 10 ms, after `sharp` is replaced.
4. **If no free host fits**, the league can't take payments on this site without a paid plan. That decision belongs to the maintainer and the owners, and nothing in this kit assumes it.

Whatever the host, the database (Neon Free), email (Resend Free), push, Google sign-in and Stripe stay the same. The [environment checklist](environment.md) and the [runbook](runbook.md) hold for every option, apart from the steps that name Vercel.
