<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Contribution rules

These rules apply to every change, whoever or whatever makes it, and to everything that reaches GitHub: commits, branch names, pull request and issue titles and bodies, comments, docs, code, test fixtures and seed data. `scripts/check-pr-hygiene.sh` checks some of them on every pull request.

## Write about the product

Describe this project as a product for the league and its players. Do not write about who built it, why they built it, their plans, their schedule or how much time they have.

## Nothing personal

Never commit or post a real email address, phone number, home location, schedule or availability, another person's name, or real email or inbox content. Test and seed data are synthetic: `example.test` email addresses and invented names.

## Never leak a secret

Never commit, print or post a token, password, API key or connection string, including in CI logs, pull request text and screenshots. Real values live only in `.env.local`, which git ignores, and in the hosting provider's encrypted settings. `.env.example` lists variable names only. Never put a secret in a URL.

## No tool attribution

Do not add co-author trailers, "generated with" lines, or the names of AI tools or assistants to commit messages, branch names, pull request or issue text, comments or docs. Code for the optional AI features may name the provider's SDK package and model identifiers where it must; commit and pull request text calls it "the AI provider".

## Branches and commits

- Branch from the latest `main`. Name the branch `<issue-number>-<slug>` or `<type>/<slug>`, where the type is `feat`, `fix`, `chore`, `docs`, `test`, `ci`, `refactor` or `perf`. If a tool created the branch with another name, rename it before the first push.
- Keep the branch current by rebasing onto `main`. Never merge `main` into a branch.
- Write small Conventional Commits, one idea each: `type(scope): imperative summary`, with a short body when the reason is not obvious.
- Commit with the maintainer's GitHub no-reply email address.
- Never create empty or backdated commits, skip hooks, or force-push to `main`.

## Pull requests

- One pull request per issue, with `Closes #N`, what changed, why, and how it was tested.
- Merge by rebase only, after every check passes.

## Keep the docs current

A pull request updates the docs its change makes stale, in the same pull request:

- `README.md`: the Features list when a feature ships or changes, and Getting started or Scripts when setup or commands change.
- `docs/data-model.md` for every schema change, `docs/architecture.md` for new jobs, integrations or flows, and `docs/information-architecture.md` for new routes or screens.
- A new ADR in `docs/adr/` when the change makes a real decision with trade-offs.

The roadmap's acceptance criteria change only when the plan changes, not to match what was built.

## Keep it fast

Players mostly use the app on phones, and a slow page is one they stop opening. Speed is part of every change, not a later pass:

- Stay within the budgets in `docs/design-system.md` (Performance budgets). Lighthouse CI enforces them on the pages in `lighthouserc.json`; add every new public page there.
- A budget miss is a bug to fix in the same pull request. Never raise a budget or turn an assertion into a warning to get a change through. If the fix belongs elsewhere, open its issue and say so in the pull request.
- Public pages are served as static HTML (`docs/architecture.md`, section 3). Read their data inside `use cache` with a `cacheTag` and `PUBLIC_PAGE_LIFE` from `src/lib/public-cache.ts`, and expire the tag from the actions that change that data. A public page never reads cookies, headers or the query string; pick a view from the path instead.
- Server components by default. Keep client JavaScript within its route budget, and load heavy client code only where it is used, as the schedule board does.
- Fetch a page's data in as few queries as it needs, in parallel where they are independent; never one query per row.
- A loading state holds the space its content will take, so nothing jumps when the content arrives.

## Free services only

The site must cost nothing to run ([ADR 0021](docs/adr/0021-free-services-only.md)):

- No feature may need a paid plan, a paid API key or a monthly bill.
- Use a service's free tier and stay inside its limit. As usage nears a limit, the feature degrades gracefully (it waits, slows down or falls back) instead of failing or costing money.
- If a feature has no free option, it is out.
- Never add a provider without adding its free limit, with a link to the provider's own page, to the free-tier budget in `docs/architecture.md` (section 15).

## Working in parallel

Several changes are often in progress at once. These rules keep them from colliding.

- **Claim the issue first.** Before starting, check that the issue has no `in progress` label, then add it. Leave issues that already carry it alone. Remove the label if you stop without a pull request.
- **One working copy per change.** Every change gets its own `git worktree`. The main checkout stays on `main`; never switch branches in a working copy that another change is using.
- **Stay in your area.** A pull request changes one feature area: its routes under `src/app`, its queries and its tests. Keep edits to shared files (`src/db/schema/index.ts`, layouts and navigation, `scripts/seed.ts`) small and additive. In the seed script, add your data in its own function instead of rewriting others'.
- **One schema change at a time.** Every pull request that adds a migration under `drizzle/` carries the `schema` label, and only one of them at a time is ready for review. The others wait as drafts, in the order they were queued, so their work and CI are visible while they wait. When it's your turn, rebase onto `main`, delete your generated SQL file, its snapshot and its `_journal.json` entry, run `npm run db:generate` again, rerun the checks, and mark the pull request ready. Never renumber a migration that has merged.
- **Your own database and port.** Create a local test database named after your branch with `PGDATABASE_NAME=<slug> scripts/setup-local-postgres.sh`, and point `DATABASE_URL` at it. Run the dev server on a free port with `npm run dev -- --port <port>`, not the default 3000. Copy `.env.local` into a new worktree with `cp`; never print it.
- **Rebase just before merging.** Rebase onto the latest `main`, rerun the checks, and merge only when they pass.

## Material that stays out of the repository

The league's rulebook PDF and full rulebook text, the real waiver text and the league's logo stay out until the league agrees to publish them.

## Before every commit, push, pull request or issue edit

Check the diff and the text against these rules. If something that breaks them has already reached GitHub, stop and tell the maintainer before doing anything else. Do not rewrite history or force-push to fix it without asking.
