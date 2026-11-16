# ADR 0094: Languages come from the path on public pages and from the profile everywhere else

- Status: accepted
- Date: 2026-11-15

## Context

The league's players speak many languages, and Spanish comes first. Language support has to fit how the site is built:

- Public pages are static HTML under Cache Components. They never read cookies, headers or the query string ([ADR 0008](0008-static-public-pages.md)), so a page can't pick a language from the browser's `Accept-Language` or a cookie without becoming dynamic.
- Route JavaScript budgets hold for every page (`docs/design-system.md`). A client-side i18n library would ship its runtime and the catalogs to every visitor.
- Emails and push are rendered on the server long after the request that queued them, so they can't take a language from a page.
- `<html lang>` should be right for screen readers and search engines, so the root layout has to know the language.
- No paid translation API may be used ([ADR 0021](0021-free-services-only.md)).

## Decision

**A small typed catalog read on the server, and a `[lang]` route segment at the top of the app.**

- **Catalogs.** `src/i18n/messages/en.ts` is the source: a plain object of messages. Each other language's catalog has the same shape, typed with `Translation<typeof en>`, so a key that doesn't exist in English won't compile. A count-dependent message is a `$plural` with a form per CLDR category, picked with `Intl.PluralRules`; `{name}` slots are filled by `fill`. `messagesFor(locale)` merges a language over English once per server instance, so a missing message falls back to English. Pages read their messages on the server and render text; the browser gets no catalog and no library.
- **The route tree.** Every page lives under `src/app/[lang]`, and the root layout sets `<html lang>` from it. It prerenders a copy of each static page per language. Route handlers that serve no page (the API, media, short links, the schedule widget's files) stay outside.
- **Public addresses.** English keeps the site's own addresses: `/faq` is served from `/en/faq`. Another language adds its code: `/es/faq`. The proxy maps an address onto the tree from the path alone, so public pages stay static. `/en/...` typed by hand redirects to the address without the prefix.
- **Page by page.** `TRANSLATED_PAGES` lists the public pages each language is served for. A page joins once all its words are translated, so nobody lands on a half-translated page. `/es/x` for a page not on the list goes to the English page. Only listed pages get the footer's language links, `hreflang` alternates and a sitemap entry per language.
- **Signed-in pages and messages.** The language is a profile setting (`profile.language`, English by default). Emails and push read it as each message is sent, so a change applies to messages already queued. The proxy reads a cookie that mirrors the setting, written whenever it is saved, and serves signed-in pages from that language's tree once their screens are translated (`SIGNED_IN_LOCALES`). Until then they show in English.
- **Formatting.** Dates, times, numbers, money and lists go through `src/i18n/format.ts`, which uses `Intl` with each language's tag (`en-US`, `es-US`). Times stay in the league's time zone.
- **Checks.** A unit test, run in CI, fails when a catalog lacks an English key, has one English doesn't, changes a message's `{slots}` or form, leaves a plural form a language needs unwritten, or is blank. Another test checks that every folder under `src/app/[lang]` is a known page root, so the proxy can't miss a new page.
- **Text admins write** (the waiver, the rules) stays as entered. A translated version an admin adds is shown beside it as a translation, and the waiver in another language is never presented as the binding text. Nothing is machine-translated.
- **Review.** The Spanish is written without a paid service. A native-speaking player reviews it before launch (`docs/i18n.md`).

## Alternatives considered

- **`next-intl` or another i18n library.** Capable, but it brings a client runtime and its own routing conventions to a codebase with tight JavaScript budgets and its own proxy. A catalog of plain objects with `Intl` covers what the league needs.
- **Language from a cookie or `Accept-Language` on public pages.** Every public page would become dynamic, and a shared link would show different languages to different people.
- **`lang` only on the content, not `<html>`.** That would avoid moving every page, but the header, footer and page title would stay in English, and search engines read the document's language.
- **One route tree per language (`src/app/es/...`).** That duplicates every page.

## Consequences

- Every page's folder moved under `src/app/[lang]`, and each page type names its route with the `/[lang]` prefix. Open branches that touch pages need a rebase; git follows the renames.
- Cache refreshes expire every language's copy: route patterns use `/[lang]/...`, and a concrete path goes through `everyLanguage(path)`.
- Static pages are prerendered once per language. Pages not yet translated still prerender a copy in the language's tree that the proxy never serves; it costs build time, not visitors.
- Adding a language means: its code in `LOCALES` with a tag and name, a catalog, a migration that widens `profile_language_known`, and its pages in `TRANSLATED_PAGES` as they are translated.
