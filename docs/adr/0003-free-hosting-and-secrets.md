# ADR 0003: Free-tier hosting, with no way to spend money by accident, and secrets that never leak

- Status: accepted; the paid-plan path under Spending is replaced by [ADR 0021](0021-free-services-only.md)
- Date: 2026-11-12

## Context

The owner wants nothing in this project to cost money without their knowledge, and never wants a token or password to leak. The repository is public.

## Decision

**Spending**

- **Vercel Hobby** for both projects (`kickball-league` and the demo). No payment method is on the account, so Vercel cannot bill; Hobby stops at its limits instead of charging overage. The Pro trial stays unused.
- **Neon Free** (`free_v3`): hard limits (10 branches, 1 GB per branch, a monthly compute allowance). It pauses rather than bills. Branches in use: `production`, `dev` (local work and previews) and `demo`.
- **No Vercel Marketplace integrations.** The Marketplace's Neon integration bills through Vercel; per-pull-request database branches will come from Neon's API in a GitHub Action instead, which stays inside the free branch limit.
- **GitHub Actions** cost nothing because the repository is public.
- **No domains are bought** and Stripe stays in test mode.
- Moving to a paid plan (for example Vercel Pro once the league takes real payments, which Hobby's non-commercial terms require) is an explicit decision by the owner, never a side effect.

**Secrets**

- Real values live only in the gitignored `.env.local` and in Vercel's encrypted environment variables. `.env.example` lists names only.
- Secrets are entered by the owner in their own terminal or dashboard; they are never written into chat, commits, pull requests, CI logs or issue text.
- **GitHub secret scanning and push protection** are on: a push containing a recognizable token is blocked.
- **A required "Secret scan" CI job** runs gitleaks over the full history on every pull request.
- `BETTER_AUTH_URL` is derived on Vercel from the deployment's own address, so it never has to be configured per preview.

## Consequences

- Hitting a free limit pauses the site or database rather than costing money; the owner decides whether to upgrade.
- Previews share the `dev` database until the per-pull-request branch action exists.
- Credentials that passed through a development session's tool output should be rotated after setup.
