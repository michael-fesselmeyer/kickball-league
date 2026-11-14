/**
 * Response headers every page and route sends (ADR 0044), set in
 * next.config.ts. Pure, so a unit test reads exactly what the browser gets.
 *
 * The Content Security Policy has no nonces: public pages are static HTML
 * served from the CDN (docs/architecture.md, section 3), and a nonce would
 * make every page render per request. So inline scripts stay allowed, and
 * the policy does the rest: scripts, styles, images, fonts and requests come
 * from this site only, nothing may frame a page, plugins are off, and forms
 * post only here or to the sign-in and payment pages we send people to.
 *
 * The one exception is the schedule widget under /embed, which any site may
 * frame so a sponsor or team can paste its snippet (docs/architecture.md,
 * section 13). It gets its own, stricter policy and no X-Frame-Options.
 */

/**
 * Where a form's redirect may land: Stripe Checkout, Google sign-in and
 * Instagram's sign-in for admins. Without JavaScript, these are form posts
 * the browser follows, which `form-action` governs.
 */
const FORM_TARGETS = [
  "https://checkout.stripe.com",
  "https://accounts.google.com",
  "https://www.instagram.com",
];

export function contentSecurityPolicy({ dev }: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next's inline bootstrap scripts; the dev server also evaluates code.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Stored photos are served from this site; an upload previews as a blob.
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    // The dev server reloads over a WebSocket.
    "connect-src": ["'self'", ...(dev ? ["ws:"] : [])],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    // Only this site's own pages, so /widget can preview the schedule widget;
    // every page but the widget refuses to be framed (frame-ancestors).
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...FORM_TARGETS],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** Every header, for `headers()` in next.config.ts. */
export function securityHeaders({
  dev,
}: {
  dev: boolean;
}): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy({ dev }) },
    // Two years, every subdomain: the site is only ever served over https.
    // Browsers ignore it on plain-http localhost.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    // For browsers that predate frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Other sites learn only that a visitor came from this one, never which
    // page (a team, a game or a sign-in link's address).
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // The camera reads photos through the file picker, never directly.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

/** The routes other sites may frame: the schedule widget. */
export const EMBED_PREFIX = "/embed/";

/**
 * The widget's policy: plain HTML with inline styles that loads nothing
 * else, submits nothing and runs no script, framed by any site.
 */
export const EMBED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *";

/** The widget's headers: the same as every page's, but framable. */
export function embedHeaders({
  dev,
}: {
  dev: boolean;
}): { key: string; value: string }[] {
  return securityHeaders({ dev })
    .filter((h) => h.key !== "X-Frame-Options")
    .map((h) =>
      h.key === "Content-Security-Policy"
        ? { key: h.key, value: EMBED_CSP }
        : h,
    );
}

/**
 * The header rules for next.config.ts: the first matches every path except
 * the embed routes (a path-to-regexp source with a negative lookahead), so
 * no page ever sends both policies.
 */
export function securityHeaderRules({ dev }: { dev: boolean }) {
  return [
    {
      source: `/((?!${EMBED_PREFIX.slice(1)}).*)`,
      headers: securityHeaders({ dev }),
    },
    { source: `${EMBED_PREFIX}:path+`, headers: embedHeaders({ dev }) },
  ];
}
