# Environment checklist

Every environment variable the app, its scripts and its tests read, found by searching the code on 2026-11-14 (`src/`, `scripts/`, `next.config.ts`, `drizzle.config.ts`, `playwright.config.ts` and `.github/`). Names only: **no value belongs in this file, in the repository, in an issue or in a chat.** Real values live in `.env.local` on your machine (git ignores it) and in the host's encrypted settings.

Two kinds of variable:

- **Validated** ones are in the Zod schema in [`src/lib/env.ts`](../../src/lib/env.ts) and in `.env.example`. A missing or malformed one stops `next build` and `next start` with the variable's name. Pairs must be set together or not at all.
- **Raw** ones are read straight from `process.env` where they are used, because they are optional switches. They are not in `.env.example`, and a bad value leaves the feature off instead of stopping the build.

"Production" below means the league's live site. "Demo" means the second project with `DEMO_MODE=true` ([ADR 0004](../adr/0004-demo-mode.md)).

## League site: set these in the host's settings

| Variable | Kind | Production | Where the value comes from | Free tier |
|---|---|---|---|---|
| `DATABASE_URL` | Validated | **Required** | Neon console → the project → Connect → the `production` branch's connection string (`postgresql://…?sslmode=require`). Use the direct (non-`-pooler`) address for migrations and backups | Neon Free |
| `BETTER_AUTH_SECRET` | Validated | **Required**, 32+ characters | Generate on your machine: `openssl rand -base64 32`. **Never change it after launch**: it signs sessions *and* derives the key that encrypts emergency contacts and the Instagram token (`src/lib/crypto/sealed.ts`). A new secret signs everyone out and makes those unreadable. Keep a copy in your password manager, apart from the backups | None needed |
| `BETTER_AUTH_URL` | Validated | Required off Vercel. On Vercel it is derived from the deployment's address when unset | `https://` plus the league's domain, no trailing slash. Set it explicitly once the domain is live: sign-in links, canonical URLs, Google's redirect and **passkeys** are tied to this host | None needed |
| `RESEND_API_KEY` + `EMAIL_FROM` | Validated pair | **Required for launch.** Without them production refuses to send sign-in links, so only Google sign-in would work | Resend dashboard → API Keys (a sending-only key for the league's domain). `EMAIL_FROM` is like `Kickball League <hello@mail.<league domain>>` on the verified domain | Resend Free: 100 a day, 3,000 a month |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Validated pair | **Required to take payments**; checkout is off without them | Stripe Dashboard in **live** mode: a restricted key (`rk_live_…`) or the secret key (`sk_live_…`); the webhook endpoint's signing secret (`whsec_…`). Live and test mode have different keys and secrets | Stripe: no monthly fee; per-payment fees come out of each payment |
| `CRON_SECRET` | Validated | **Required for launch.** Without it every scheduled job refuses to run (reminders, the outbox sweep, score finalizing) | Generate: `openssl rand -base64 32`. Vercel Cron sends it as `Authorization: Bearer …` on its own once the variable is set | None needed |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Validated pair | Recommended: push is off without them | `npm run push:keys` writes a pair to `.env.local`; copy both to the host. **Never change the pair after launch**: every phone would have to turn push on again | None: browsers' push services charge nothing |
| `VAPID_SUBJECT` | Validated | Optional; defaults to the site's address | A `mailto:` address for the league, or the site's `https://` URL | None |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Validated pair | Optional; adds "Continue with Google" | Google Cloud console → Google Auth Platform → Clients → a Web application client. The secret is shown once, when it is created | Google sign-in: free |
| `OPERATOR_USER_IDS` | Raw | Optional, but needed once to appoint the owners ([ADR 0009](../adr/0009-platform-operator.md)) | The account id of the maintainer's own sign-in (from the `user` table), comma-separated for more than one. Not a secret | None |
| `INSTAGRAM_APP_ID` + `INSTAGRAM_APP_SECRET` | Raw pair | Optional; the Instagram photo sync | Meta developer dashboard → the league's app → Instagram API with Instagram Login | Meta: free |
| `EMAIL_DAILY_LIMIT`, `EMAIL_MONTHLY_LIMIT`, `EMAIL_RESERVE` | Raw | Leave unset | Defaults match Resend Free (100, 3,000 and 10). Set only if the email provider's free allowance changes | n/a |

## Set by the host or the framework: never set these yourself

| Variable | Read by | Notes |
|---|---|---|
| `NODE_ENV` | `src/app/layout.tsx`, `src/lib/auth/index.ts`, `src/services/outbox.ts`, `src/seed/guard.ts` | Next.js sets it |
| `NEXT_PHASE` | `src/lib/build-phase.ts` | Next.js sets it during the build |
| `VERCEL_ENV` | `src/lib/site.ts` (search indexing), `src/lib/env.ts`, `src/lib/demo/guard.ts`, `src/seed/guard.ts` | Vercel sets it. **Another host has no such variable, so production would be marked `noindex`**: see [hosting.md](hosting.md) |
| `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | `src/lib/env.ts`, `src/lib/demo/guard.ts` | Vercel sets them; they fill in `BETTER_AUTH_URL` when it is unset |

## Demo project only

| Variable | Kind | Notes |
|---|---|---|
| `DEMO_MODE` | Raw | `true` on the demo project only. It takes effect only when the database's name contains `demo`, the production address contains `demo`, and Stripe is not live. **Never set it on the league's project** |
| `OPERATOR_USER_IDS` | Raw | On the demo, the Admin persona's fixed id from the seed (as in `playwright.config.ts`), so volunteers can try the operator console and the owner screens ([acceptance testing](acceptance-testing.md)) |
| `INSTAGRAM_FIXTURE` | Raw | `true` plays back a recorded Instagram API. Ignored in a production build unless demo mode is on |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Validated pair | **Test-mode** keys only (`sk_test_…`). A live key turns demo mode off |

## Local development, tests and scripts

| Variable | Read by | Notes |
|---|---|---|
| `SKIP_ENV_VALIDATION` | `next.config.ts` | `true` only in `npm run typecheck`. Never in hosting |
| `STRIPE_MOCK_URL` | `src/services/stripe-mock.ts` | Sends Stripe calls to a local stripe-mock. Ignored unless the key is a test key and the address is `localhost` |
| `CI`, `E2E_SMOKE_PORT`, `E2E_FLOWS_PORT`, `E2E_PREBUILT`, `E2E_SITE_WIDE` | `playwright.config.ts` | End-to-end test switches |
| `PGDATABASE_NAME`, `PG_SUPERUSER_URL`, `PGUSER_NAME`, `PGPASSWORD_VALUE`, `PGHOST_NAME`, `PGPORT_NUMBER` | `scripts/setup-local-postgres.sh` | Local test databases |
| `SOURCE_DATABASE_URL`, `SCRATCH_DATABASE_URL`, `BACKUP_DIR`, `PG_TOOLS_CONTAINER`, `KEEP_DUMP` | `scripts/backup-drill.sh` | The [backup and restore drill](backup-and-restore.md) |

## GitHub repository secrets

| Secret | Used by | Notes |
|---|---|---|
| `BLOCKED_TERMS` | The pull request hygiene check | Already set. Its contents stay out of the repository |

A host other than Vercel adds its own deploy token (for example a Cloudflare API token) as a repository secret. That is part of a hosting change, not this launch.

## Before launch day

- [ ] Every **Required** row above has a value in the production environment, entered by the maintainer in the host's dashboard or CLI, straight from their own terminal or password manager.
- [ ] The production values are all live-mode and production ones: no `sk_test_`, no `DEMO_MODE`, no `localhost`.
- [ ] `BETTER_AUTH_SECRET` and the VAPID pair are saved in the maintainer's password manager. Losing the secret loses the emergency contacts; losing the VAPID pair means everyone turns push on again.
- [ ] Credentials that ever appeared in a development session's tool output are rotated before launch ([ADR 0003](../adr/0003-free-hosting-and-secrets.md)). `BETTER_AUTH_SECRET` is the exception: rotate it only before any real emergency contact is saved.
