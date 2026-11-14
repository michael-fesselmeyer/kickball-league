import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

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
