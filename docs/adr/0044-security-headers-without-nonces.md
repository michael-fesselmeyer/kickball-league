# ADR 0044: Security headers on every response, with a Content Security Policy that keeps pages static

- Status: accepted
- Date: 2026-11-14

## Context

The site sent no security headers of its own. Any other site could show a page of it in a frame (and trick a player into clicking a button there), a browser could guess a file's type, and nothing limited where a page could load scripts or send forms from.

A strict Content Security Policy uses a nonce: a fresh random value per response that every script tag must carry. Next.js can add one, but only to pages it renders per request. Public pages here are static HTML served from the CDN (docs/architecture.md, section 3), which is how they stay inside the performance budgets, and a nonce would make every one of them render on each visit. Next.js's experimental hash-based alternative (Subresource Integrity) covers script files, not the inline scripts every page carries, and is not yet stable.

## Decision

**One set of headers on every response**, built by `securityHeaders` in `src/lib/security-headers.ts` and set for `/:path*` in `next.config.ts`:

- **Content-Security-Policy without a nonce.** Scripts, styles, images, fonts, requests, workers and the manifest come from this site only (`'self'`, plus `data:` and `blob:` images for icons and upload previews). Inline scripts and styles stay allowed (`'unsafe-inline'`), since Next.js's static pages need them. No page may be framed (`frame-ancestors 'none'`), none frames anything (`frame-src 'none'`), plugins are off (`object-src 'none'`), `<base>` can't move links elsewhere (`base-uri 'self'`), and forms post only here or redirect to Stripe Checkout, Google sign-in and Instagram's sign-in (`form-action`). The dev server alone adds `'unsafe-eval'` and WebSocket requests.
- **Strict-Transport-Security** for two years, subdomains included.
- **X-Frame-Options: DENY** for browsers older than `frame-ancestors`.
- **X-Content-Type-Options: nosniff.**
- **Referrer-Policy: strict-origin-when-cross-origin**, so other sites see only the site's address, never which page.
- **Permissions-Policy** turning off the camera, microphone, location, payment and USB APIs, none of which the site uses: photos come through the file picker.
- **Cross-Origin-Opener-Policy: same-origin**, so a page opened from another site can't reach back into this one.

Routes that serve stored files keep their own stricter policy (`default-src 'none'`). A unit test checks the policy's directives, and the e2e smoke test reads the headers from the running site.

## Alternatives considered

- **Nonces, with every page rendered per request.** The strongest policy against injected scripts, but it gives up the CDN and the page-speed budgets for every visitor, to defend against a kind of bug React's escaping already prevents (no page renders user text as HTML; JSON-LD is escaped).
- **Experimental Subresource Integrity hashes.** Keeps pages static, but does not cover inline scripts and may change between Next.js versions.
- **No policy until nonces are cheap.** Leaves framing, plugins, `<base>` and form targets open in the meantime, which a policy without nonces already closes.

## Consequences

- An injected inline script would still run, so output encoding stays the main defense: user text is never rendered as HTML.
- A new external service a page loads from, or a new site a form redirects to, must be added to the policy, or the browser blocks it.
