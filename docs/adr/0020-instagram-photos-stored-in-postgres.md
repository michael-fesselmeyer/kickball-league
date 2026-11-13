# ADR 0020: Instagram photos through the official API, stored in Postgres

- Status: accepted
- Date: 2026-11-13

## Context

The league keeps its photos current on Instagram. The roadmap (section 4, item 21) asks for an admin to connect that account once, for recent posts to sync and be copied to our storage, for admins to choose what shows, and for every photo to link back to its post. Four questions needed an answer: which API, where the copies live, how the access token is kept, and how this is built and tested without a real account.

Meta retired the Basic Display API. Its current reference (checked in November 2026, version v27.0) offers the Instagram API with Instagram Login: the account's owner signs in on Instagram's own screen, the app receives a token that lasts 60 days and can be refreshed, and `/me/media` lists the account's posts with short-lived image addresses. It works only for professional (Business or Creator) accounts. An app that serves only accounts with a role on it needs no App Review.

The project has no Blob store yet: section 9 of the architecture plans Vercel Blob for uploads, but nothing uses it, and adding a package needs approval.

## Decision

**The official API with Instagram Login, asking only for `instagram_business_basic`.** No scraping, no Facebook Login. The client (`src/services/instagram.ts`) sends tokens in the `Authorization` header, so they never appear in a URL we build or log, and words every failure for admins without the URL or token. A refused token (code 190, or any OAuth error that is not a rate limit) is an `auth` failure: the account needs reconnecting. Anything else is passing and the next run retries.

**Photos are copied into Postgres** (`social_image`, `bytea`), one per post, and served from `/media/instagram/[image]` through `next/image`. A sync reads 25 posts, so the table holds a few dozen photos of a few hundred kilobytes each: a few megabytes, well inside the database's free tier. Only https addresses on Instagram's CDNs are fetched, and only JPEG, PNG or WebP up to 8 MB is stored, with `nosniff` and a `default-src 'none'` policy on the response. The public route answers only for photos that are shown, so hiding one also stops its address working once caches expire.

**The token is encrypted with AES-256-GCM** under a key derived (HKDF-SHA256) from `BETTER_AUTH_SECRET`, with the account's row ID as additional data, so a database copy alone cannot use it and a ciphertext moved to another row does not decrypt. Rotating the auth secret makes the token unreadable, which the jobs treat as "needs reconnecting". Disconnecting deletes it; a check constraint keeps a disconnected row from holding one.

**A recorded fixture stands in for Instagram** in tests, development and the demo. `src/services/instagram-fixture.ts` answers each endpoint with JSON recorded in the real API's shape (`src/services/fixtures/instagram`) and draws a small PNG for each photo address, so no binary file and no real photo is committed. Tests inject it; `INSTAGRAM_FIXTURE=true` uses it in the running app, where "Connect" goes straight back to the callback with the fixture's code. It is ignored when a real app is configured, and in a production build unless demo mode is on, so the league's site can never show fixture photos.

**Off by default, read from the raw environment.** The connection needs `INSTAGRAM_APP_ID` (the Instagram app's numeric ID) and `INSTAGRAM_APP_SECRET`, or `INSTAGRAM_FIXTURE=true` for the recorded fixture. Like `DEMO_MODE` (ADR 0004) and `OPERATOR_USER_IDS` (ADR 0009), they are optional and stay out of the validated schema and `.env.example`; `src/lib/social/instagram-settings.ts` checks them where they are used. Unset, the jobs skip, the admin screen explains what is missing, and the public photo areas render nothing. Half a pair or a malformed value fails safe the same way, and the server log and admin screen name the variable, never its value.

## Alternatives considered

- **Vercel Blob for the copies**, as section 9 plans for uploads. Better for large or many files, and CDN-served without a function. Not chosen now: it needs a new package and a store set up at launch, for a few megabytes of photos. The copies sit behind one table and one route, so moving them later changes `applySync` and the image route, not the pages.
- **Linking to Instagram's image addresses.** They expire within days, and every page view would load from Meta's CDN.
- **Instagram's embed script.** A third-party script on public pages breaks the performance budgets and the "no third-party scripts" rule, and tracks visitors.
- **A dedicated encryption key variable.** One more secret to set and rotate for a single token; deriving from the auth secret costs a reconnect at worst.
- **Validating the app ID and secret at startup** with the other variables in `src/lib/env.ts`. A typo would then stop the whole site for an optional feature, and every schema variable must be listed in `.env.example`. Checking them where they are used keeps the site up and the feature off.
- **Reading every post with paging.** The site shows recent photos; 25 posts is one request. The cost is that a post older than the page that is deleted on Instagram stays until an admin hides it.

## Consequences

- Admins see a "Reconnect Instagram" notice and get one email if Instagram stops accepting the token; photos already synced stay up.
- A hidden photo leaves every page on its next render, and its address keeps answering from caches for up to five minutes: the photo route and the image optimizer (`images.minimumCacheTTL`) both keep copies that long. The photos are few and small, so the extra requests cost little.
- Tagging posts to events waits for the events calendar's `event` table, and adds a column then.
- Tests cover the client against the fixture (token exchange, refresh, refused tokens, media parsing, the CDN allow-list and size limits), the encryption, the sync plan with property tests, and the database rules: sync is idempotent, curation survives syncs, deletions, covers, disconnecting and reconnect notices.
