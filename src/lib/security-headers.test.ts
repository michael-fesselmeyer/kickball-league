import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  EMBED_CSP,
  securityHeaderRules,
  securityHeaders,
} from "./security-headers";

/** The policy as a map of directive to its sources. */
const parse = (policy: string) =>
  new Map(
    policy.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values] as const;
    }),
  );

describe("contentSecurityPolicy", () => {
  const csp = parse(contentSecurityPolicy({ dev: false }));

  it("lets no other site frame a page", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("loads scripts, images and requests from this site only", () => {
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("connect-src")).toEqual(["'self'"]);
    expect(csp.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  it("turns off plugins and base-URL tricks", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
  });

  it("lets forms go only here and to the sign-in and payment pages", () => {
    expect(csp.get("form-action")).toEqual([
      "'self'",
      "https://checkout.stripe.com",
      "https://accounts.google.com",
      "https://www.instagram.com",
    ]);
  });

  it("allows eval and WebSockets for the dev server only", () => {
    expect(csp.get("script-src")).not.toContain("'unsafe-eval'");
    const dev = parse(contentSecurityPolicy({ dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
  });
});

describe("securityHeaders", () => {
  const headers = new Map(
    securityHeaders({ dev: false }).map((h) => [h.key, h.value]),
  );

  it("sends the headers every response needs", () => {
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });
});

/**
 * The headers a path gets from the rules, matched the way Next.js matches
 * custom header sources, a later rule replacing an earlier one's key.
 */
function headersFor(pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of securityHeaderRules({ dev: false })) {
    const match = getPathMatch(rule.source, { removeUnnamedParams: true });
    if (match(pathname) === false) continue;
    for (const h of rule.headers) out[h.key] = h.value;
  }
  return out;
}

describe("securityHeaderRules", () => {
  it("let any site frame the schedule widget, and nothing else", () => {
    for (const path of ["/embed/schedule", "/embed/schedule/the-big-kicks"]) {
      const headers = headersFor(path);
      expect(headers["Content-Security-Policy"], path).toBe(EMBED_CSP);
      expect(headers["X-Frame-Options"], path).toBeUndefined();
      expect(headers["X-Content-Type-Options"], path).toBe("nosniff");
      expect(headers["Strict-Transport-Security"], path).toContain("max-age=");
    }
    expect(EMBED_CSP).toContain("frame-ancestors *");
    // The widget runs no script, whoever frames it.
    expect(EMBED_CSP).toContain("default-src 'none'");
    expect(EMBED_CSP).not.toContain("script-src");
  });

  it("keep every other page out of frames", () => {
    for (const path of [
      "/",
      "/help",
      "/widget",
      "/sign-in",
      "/app",
      "/app/admin/today",
      "/seasons/fall-2026/schedule",
      "/embedded",
      "/embed",
      "/teams/the-big-kicks/calendar.ics",
    ]) {
      const headers = headersFor(path);
      expect(headers["Content-Security-Policy"], path).toBe(
        contentSecurityPolicy({ dev: false }),
      );
      expect(headers["X-Frame-Options"], path).toBe("DENY");
    }
  });
});
