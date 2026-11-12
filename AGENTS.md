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

## Material that stays out of the repository

The league's rulebook PDF and full rulebook text, the real waiver text and the league's logo stay out until the league agrees to publish them.

## Before every commit, push, pull request or issue edit

Check the diff and the text against these rules. If something that breaks them has already reached GitHub, stop and tell the maintainer before doing anything else. Do not rewrite history or force-push to fix it without asking.
