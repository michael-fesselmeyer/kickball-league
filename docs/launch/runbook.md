# Launch runbook

Step by step, for the maintainer, from an empty production database to the league's domain serving the new site. Every step ends with a **smoke test**. Don't start the next step until the smoke test passes. If one fails, stop, and undo only that step.

The steps assume the host stays **Vercel** ([hosting.md](hosting.md), recommendation 1). On another host, steps 8, 9 and 11 change, and the rest stay as written.

## Ground rules

- **Secrets never leave your own terminal or password manager.** Don't paste one into a chat, an issue, a pull request, a commit or a screenshot. Load each into your shell without echoing it, and only for the command that needs it:

  ```bash
  read -rs PROD_DATABASE_URL && export PROD_DATABASE_URL   # paste, then Enter; nothing is shown
  ```

  Close the terminal when you're done.
- **Keep a launch log** outside the repository (a note in your password manager works): the date of each step, which values were set where (names, never values), and the old DNS records from step 11.
- **Never run `npm run seed` against production.** The seed script refuses only when it can tell it is production (`NODE_ENV` or `VERCEL_ENV`), and a terminal on your machine has neither. Pointed at the production URL from your laptop, it would write an invented league into the real database. `npm run demo:reset` is safe: it refuses any database whose name lacks `demo`.
- Freeze merges to `main` from the start of step 9 until step 12 passes.

## Before you start

- [ ] The host is decided ([hosting.md](hosting.md)), and Vercel's written answer, if any, is in the launch log.
- [ ] The league has supplied or approved the real waiver, terms and privacy policy ([roadmap](../roadmap.md), section 6, "Legal text").
- [ ] Old site's URLs collected from its sitemap or menu, and a pull request that redirects each one to its new page has merged (roadmap, "Domain").
- [ ] Tools on your machine: Node 24 (`nvm use`), a fresh checkout of `main` with `npm ci` run, and a Postgres 18 client for backups: `brew install libpq` (free), then put its `bin` folder on your `PATH`.
- [ ] Access you already have: the Neon project, the Vercel project, the GitHub repository, the domain's DNS at its registrar, and the league's Stripe account (the league owns it; you need a login with developer access).

## 1. Production database

Use the existing Neon project's `production` branch ([ADR 0003](../adr/0003-free-hosting-and-secrets.md)). Don't create a new project or turn on anything paid.

1. In the Neon console, open the project → Branches → `production`. Check that it is the default branch and that its compute is capped at **0.25 CU** with scale to zero on ([architecture.md](../architecture.md), section 15).
2. Connect → choose `production`, the database, and **turn connection pooling off** for the direct address. Copy it straight into your password manager as "League production database (direct)".
3. If the branch has old test data in it, reset it from Neon's console (Branches → `production` → Reset from parent, or delete and recreate the branch from an empty parent). Check the branch name twice first.

**Smoke test**

```bash
read -rs PROD_DATABASE_URL && export PROD_DATABASE_URL
psql "$PROD_DATABASE_URL" -Atc "select current_database(), version()"
psql "$PROD_DATABASE_URL" -Atc "select count(*) from pg_tables where schemaname = 'public'"
```

Expect the database name, `PostgreSQL 18.x`, and `0` tables before migrating.

## 2. Migrations

Migrations are not part of the build. Run them from your machine, from a clean checkout of `main`:

```bash
git switch main && git pull --ff-only && npm ci
DATABASE_URL="$PROD_DATABASE_URL" npm run db:migrate
```

After launch, run the same command **before** merging any pull request that adds a file under `drizzle/`. Every migration is written to be safe with the previous deploy still running ([architecture.md](../architecture.md), section 10).

**Smoke test**: the number of applied migrations matches the repository's journal.

```bash
psql "$PROD_DATABASE_URL" -Atc "select count(*) from drizzle.__drizzle_migrations"
node -p "require('./drizzle/meta/_journal.json').entries.length"
```

Both print the same number (52 on 2026-11-14).

## 3. Secrets you generate yourself

Generate each one in your terminal and save it straight into your password manager:

| Variable | Command |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 32` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npm run push:keys`. It writes both to `.env.local` and prints only the public key. Move them to your password manager, then delete them from `.env.local` if that file is for development |

`BETTER_AUTH_SECRET` and the VAPID pair are **for good**. The secret also encrypts emergency contacts and the Instagram token, and the VAPID pair is what every phone's push subscription is tied to ([environment.md](environment.md)).

**Smoke test**: each saved value has the right shape. `BETTER_AUTH_SECRET` is at least 32 characters, `CRON_SECRET` at least 16, the public key starts with `B` and is 87 characters, the private key is 43. Step 9's build checks the same and names any that are wrong.

## 4. Email sending domain (Resend Free)

Send from a **subdomain** of the league's domain, such as `mail.<league domain>`, as Resend recommends ([Resend: domains](https://resend.com/docs/dashboard/domains/introduction)). This keeps the league's own inbox and its reputation separate, and it needs no change to the domain's existing MX records.

1. Resend dashboard → Domains → Add domain → `mail.<league domain>`.
2. Resend shows the exact records to add on its Records tab ([Resend: add a domain](https://resend.com/docs/add-a-domain.md)). Add them at the registrar **exactly as shown**:
   - **SPF**: an `MX` record and a `TXT` record (`v=spf1 include:…`) on the bounce subdomain Resend names (by default `send.mail.<league domain>`).
   - **DKIM**: a `TXT` record with Resend's public key, at the name Resend gives under `_domainkey`.
3. Add **DMARC** yourself: a `TXT` record at `_dmarc.<league domain>` (it covers subdomains), starting with monitoring only ([Resend: DMARC](https://resend.com/docs/dashboard/domains/dmarc)):

   ```text
   v=DMARC1; p=none; rua=mailto:<a league address that receives reports>;
   ```

   If the domain already has a DMARC record, keep it and don't add a second one. Once reports show SPF and DKIM passing for a few weeks, raise the policy to `p=quarantine`, and later to `p=reject`.
4. Wait for Resend to show **Verified**: often within 15 minutes, at most 72 hours.
5. Resend → API Keys → create a key with **sending access** for this domain only. Save it in your password manager as `RESEND_API_KEY`. Decide `EMAIL_FROM`, for example `Kickball League <hello@mail.<league domain>>`.

**Smoke test**

```bash
dig +short TXT _dmarc.<league domain>
dig +short TXT send.mail.<league domain>
dig +short MX send.mail.<league domain>
```

Each shows the record you added. Resend shows the domain as Verified. The real test is step 9's sign-in email: open it in Gmail → ⋮ → Show original, and SPF, DKIM and DMARC all read `PASS`.

## 5. Web push keys

The keys come from step 3. Nothing else is needed: browsers' push services charge nothing and need no account ([architecture.md](../architecture.md), section 15).

- Set `VAPID_SUBJECT` to `mailto:<league address>` or leave it unset (it defaults to the site's address).

**Smoke test** (after step 9): on an Android phone or an iPhone with the app added to the home screen, sign in → Profile → turn on push for scores. Have an admin post a test score on a test game. The phone gets a notification within a minute.

## 6. Stripe live mode

The league's own Stripe account takes the money. Only someone the league authorizes completes Stripe's activation. You need developer access to its dashboard.

1. Stripe Dashboard → activate the account: business details, the support contact and website players will see, the statement descriptor, and the bank account for payouts ([Stripe: activate](https://docs.stripe.com/get-started/account/activate)). The league's owner does this; it is their business information.
2. Switch to **live mode**. Developers → API keys → create a **restricted key** (`rk_live_…`), which Stripe recommends over the full secret key ([Stripe: API keys](https://docs.stripe.com/keys)). The app calls only these, so give it write access to Checkout Sessions, Customers, PaymentIntents and Refunds, read access to SetupIntents and PaymentMethods, and nothing else. A live restricted key is shown once: save it straight to your password manager as `STRIPE_SECRET_KEY`.
3. Workbench → Webhooks → Create an event destination → Webhook endpoint ([Stripe: webhooks](https://docs.stripe.com/webhooks)):
   - URL: `https://<league domain>/api/stripe/webhook` (do this in step 11, once the domain points at the new site; until then the live keys stay in your password manager only).
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
   - Reveal the signing secret (`whsec_…`) and save it as `STRIPE_WEBHOOK_SECRET`. Live and test endpoints have different secrets.
4. Leave Stripe Tax, Billing and a custom Checkout domain **off**: they cost money ([architecture.md](../architecture.md), section 15).

**Smoke test** (in step 11, after the live keys are set): register for a real $1 test fee on a hidden test season, pay with a real card, and see the registration turn paid within seconds; Stripe → Webhooks shows a `200` for the event. Refund it from the app's registrations screen; the purchase shows **refunded** after `charge.refunded` arrives. This is the roadmap's "a real $1 payment and refund succeed end to end".

## 7. Google sign-in

1. Google Cloud console → a project for the league → Google Auth Platform:
   - Branding: the league's name, support email and links to the privacy policy and terms.
   - Audience: **External**, then **Publish app** (production). For `openid`, `email` and `profile` only, Google doesn't require app verification, and the 100-user limit applies only while the app is in Testing ([Google: verification](https://support.google.com/cloud/answer/13463073), [FAQ](https://support.google.com/cloud/answer/13463817)). Brand verification is optional; it only adds the logo to the consent screen.
2. Clients → Create client → Web application. Authorized redirect URIs, typed exactly (scheme, case, no trailing slash):
   - `https://<league domain>/api/auth/callback/google`
   - the host's own address, for the dry run: `https://<project>.vercel.app/api/auth/callback/google`
3. Save the client ID and the secret (shown once) as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Smoke test** (after step 9): sign in with Google on the host's address in a private window. You land on the app signed in, and Profile shows your Google email. Changes to redirect URIs can take from 5 minutes to a few hours to apply.

## 8. Environment variables in the host

In Vercel → the league's project → Settings → Environment Variables, add each variable for the **Production** environment only, pasting from your password manager. Or use the CLI, which reads the value from your terminal:

```bash
npx vercel env add BETTER_AUTH_SECRET production
```

Set: `DATABASE_URL` (the pooled address is fine for the app), `BETTER_AUTH_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optionally `VAPID_SUBJECT`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. For the dry run, use **test-mode** Stripe keys and a test webhook endpoint on the host's address. Leave `BETTER_AUTH_URL` unset until step 11, so it follows the host's address.

Preview deployments must never get production values: give the **Preview** environment the `dev` branch's database and Stripe test keys only, or nothing.

**Smoke test**: `npx vercel env ls production` lists every name in [environment.md](environment.md)'s "Required" rows (it shows names, not values). `DEMO_MODE` is **not** in the list.

## 9. Turn deployments back on

1. In a pull request, remove `"git": { "deploymentEnabled": false }` from `vercel.json` ([architecture.md](../architecture.md), section 10). Merging it to `main` makes the first production deploy, still only at the host's address. The domain keeps serving the old site.
2. Watch the build in Vercel. Environment validation runs first and names any missing or malformed variable.

**Smoke test**

- `https://<project>.vercel.app/` loads the home page; the schedule and teams pages load.
- Sign in by email link: the email arrives within a minute, and its headers pass SPF, DKIM and DMARC (step 4).
- Vercel → Settings → Cron Jobs lists all 11 jobs. Run one by hand ("Run" on `/api/jobs/outbox`): it returns `200`, not `401` or `503`.
- The response headers of `/` contain no `x-robots-tag: noindex` and the page has no `noindex` meta tag (production is indexed only when `VERCEL_ENV` is `production`).

## 10. Appoint the owners and enter the season

Production is **not seeded**: players re-register, and the league is entered through the app ([open questions](../open-questions.md), question 50).

1. Sign in once on the host's address with your own account. Find your account id:

   ```bash
   psql "$PROD_DATABASE_URL" -Atc "select id from \"user\" where email = '<your sign-in email>'"
   ```

   Set it as `OPERATOR_USER_IDS` in Vercel (step 8) and redeploy. It is not a secret, but keep it out of the repository ([ADR 0009](../adr/0009-platform-operator.md)).
2. Have each owner and admin sign in once. Then open `/operator` → "Change a person's role" and make each one an owner or an admin by their account email.
3. The owners or admins enter the league in the app: Admin → Seasons → the spring season with its dates, prices and deadlines; fields, permit windows and blackout dates; divisions if any; and the returning teams with their names and colors (roadmap, "Data"). From the second season on, **Season rollover** copies a season forward.
4. Do the **dry run** (roadmap, "Dry run"): one commissioner and two captains go through registration, a test-mode payment, a mock game and a mock rain-out, using the [acceptance checklist](acceptance-testing.md).

**Smoke test**: `/operator` opens for you and returns "not found" for an owner. Each owner sees the books and the owner dashboard. The public schedule page shows the season once its schedule is published. Then hide or delete the dry-run's test data, or mark the test season as a test.

## 11. Domain cut-over

The old site keeps running until this step, and switching back is one change.

**A day before**

1. **Save the old DNS.** At the registrar, export the zone file, or copy every record into the launch log: `A`, `AAAA`, `CNAME` (including `www`), `MX`, every `TXT` (SPF, site verifications), `CAA` and the `NS` servers, each with its TTL. Also save what you see from outside:

   ```bash
   for t in A AAAA CNAME MX TXT CAA NS; do echo "== $t"; dig +noall +answer <league domain> $t; dig +noall +answer www.<league domain> $t; done
   ```

2. Lower the TTL of the apex `A`/`AAAA` and `www` records to 300 seconds, so both the switch and a rollback take effect within minutes.
3. In Vercel → Settings → Domains, add `<league domain>` and `www.<league domain>`, with one redirecting to the other. Vercel shows the exact records it wants. Copy them into the launch log next to the old ones.

**Cut-over**

4. At the registrar, change **only** the website records (apex `A`/`AAAA`, `www`) to Vercel's values. Leave `MX`, the mail `TXT` records and Resend's records alone.
5. In Vercel, set `BETTER_AUTH_URL=https://<league domain>` for Production and redeploy. Sessions and **passkeys** belong to the address, so everyone from the dry run signs in again, and re-adds a passkey if they want one.
6. Stripe: create the **live** webhook endpoint on `https://<league domain>/api/stripe/webhook` (step 6), then replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel with the live values and redeploy. Delete the test endpoint for the host's address.
7. Search: verify the domain in Google Search Console (a DNS `TXT` record) and submit `https://<league domain>/sitemap.xml`.

**Smoke test**

- `dig +short <league domain>` shows Vercel's values. Vercel shows the domain as valid, with a certificate issued.
- `https://<league domain>/` and `https://www.<league domain>/` both load the new home page; one redirects to the other.
- A few of the old site's URLs redirect to their new pages.
- Sign in by email link and with Google on the domain.
- The $1 live payment and refund from step 6's smoke test.
- The league's email (MX) still receives mail: send a test message to the league's address.

**Rollback**: put the saved apex and `www` records back at the registrar. Within the 300-second TTL the old site is back. Set Stripe's live webhook endpoint to disabled. Nothing in the database has to change.

## 12. After launch

- [ ] Run the [backup and restore drill](backup-and-restore.md) against production, and put it on the calendar monthly in season.
- [ ] Set up the free alerts in [monitoring.md](monitoring.md) and check each one fires.
- [ ] Turn on the **demo** project too, if it isn't already: its own Neon branch named with `demo`, `DEMO_MODE=true`, test-mode Stripe keys, and an address containing `demo`.
- [ ] Two weeks after launch, raise the DMARC policy if reports are clean (step 4), and put the DNS TTLs back to their usual value.
- [ ] Each week in season, an admin checks usage against the free limits: Vercel's Usage page, Neon's CU-hours and Resend's sending count ([architecture.md](../architecture.md), section 15).
