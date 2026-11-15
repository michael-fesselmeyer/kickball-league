# ADR 0066: A searchable rulebook stored in the app

- Status: accepted
- Date: 2026-11-15

## Context

Players look the rules up in a document. The rules page ([ADR 0062](0062-rules-page-with-a-dated-change-log.md)) holds sections an admin types in, but a whole rulebook is too long to retype section by section, and players need to find one rule quickly on a phone.

The league has not agreed to publish its rulebook, so none of its text may reach the repository, a test, a screenshot or a pull request. It has to live in the database, entered by an owner, and stay hidden until the league decides.

## Decision

**The rulebook is the existing `rule_section` table, now imported from pasted text, searchable, and gated by a per-league switch.**

- **Import.** An owner pastes the text. The browser splits it into numbered sections and rules (`splitRulebook`, pure): headings are markdown, "Section N", ALL CAPS, or short numbered lines such as "3. Pitching"; a rule starts at "3.1" or "3."; wrapped lines are joined; bullets become a list; page numbers are dropped. The owner reviews and edits the result, then saves. Saving is an ordinary publish ([ADR 0062](0062-rules-page-with-a-dated-change-log.md)): a section with the same title as a current one is edited, so its anchor survives, a new title is added and a section left out is removed. The dated change log records it, with the usual stale-editor refusal. The split text is sent to the server only on save, and the server validates it again.
- **Anchors.** Each section has its slug anchor; each numbered rule has `rule-<slug>--<number>`, so a link can land on one rule. The numbers are the ones the rulebook uses.
- **Search.** `rule_section.search` is a generated `tsvector` (title weighted above text) with a GIN index. A route handler at `/rules/search` turns the typed words into a prefix `to_tsquery` built only from letters and digits, ranks sections with `ts_rank_cd`, and then finds the numbered rules in each that hold the words. A result moves the address to the rule (`?h=<words>#<anchor>`) and the page highlights the words with the CSS Custom Highlight API, without changing the markup. Searches are limited per network in the shared `rate_limit` table. Postgres full-text search costs nothing extra ([ADR 0021](0021-free-services-only.md)).
- **Visibility.** `league.rulebook_visibility` is `owners` (the default), `members` or `public`; only owners (and the operator) change it, and each change is audited. Owners see the text at `/app/rules` while it is owners only; anyone signed in to the league sees it there when it is members only; everyone sees it on the public page when it is public. The search route answers by the same rule, read fresh on every request.
- **Public page.** `/rules` stays static HTML read inside `use cache` with the `rules` tag and `PUBLIC_PAGE_LIFE`. It reads the rulebook's text and change log only when the league is public, so nothing of it is in the cached page otherwise. Publishing and changing the switch both expire the tag. The only client JavaScript is the search box and the highlighter.
- **Test data.** Seeds and tests use an invented sample rulebook (`src/domain/rules/sample-rulebook.ts`). The real rulebook is never in the repository.

## Alternatives considered

- **PDF upload.** Extracting text on the server needs a PDF library, and none is in the project. Pasting text from the PDF works today; upload can be added once a small free library is approved.
- **A table of rules.** One row per rule would make rule-level search a plain query, but it needs a second table and a second history. Parsing numbered paragraphs out of the section text keeps one source of truth and the existing change log.
- **Searching in the browser.** Every section is already in the page, but the work belongs in the database ([ADR 0062](0062-rules-page-with-a-dated-change-log.md) says the text lives there) and the same endpoint serves the in-app and public views.
- **Hide the page by not linking it.** A switch the owners control is explicit, audited and enforced by the server.

## Consequences

- A league's rules page shows no rulebook text until its owners choose public. Leagues that already published rules keep their text and log, but it no longer shows publicly until they switch it on.
- The heading detection is a heuristic. The review step exists because a rulebook can be laid out in ways it misreads.
- Search needs one request per search at a time the visitor chooses; the cost is the free database's reads, bounded by the per-network limit.
- Rule-level matching uses word prefixes and simple stemming, while the section ranking uses Postgres's English stemming. A rule that matches only through a more complex stem is found at the section, not the rule.
