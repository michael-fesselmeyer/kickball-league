import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteStatus } from "@/domain/platform/operator";
import { config, proxy } from "./proxy";

const site: { status: SiteStatus } = vi.hoisted(() => ({ status: "active" }));
vi.mock("@/lib/platform/site", () => ({
  siteForProxy: async () => ({
    leagueId: "league",
    name: "Test League",
    slug: "demo-league",
    status: site.status,
    disabledFeatures: [],
  }),
}));

beforeEach(() => {
  site.status = "active";
});

const request = (path: string, cookie?: string) =>
  new NextRequest(
    `http://localhost:3000${path}`,
    cookie ? { headers: { cookie } } : {},
  );

describe("proxy", () => {
  it("redirects the default league's slug to the site's own address, over HTTP", async () => {
    for (const [path, target] of [
      ["/l/demo-league/records", "/records"],
      ["/l/demo-league", "/"],
      ["/l/demo-league/seasons/fall-2026?x=1", "/seasons/fall-2026?x=1"],
    ] as const) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(308);
      const location = new URL(response.headers.get("location")!);
      expect(`${location.pathname}${location.search}`, path).toBe(target);
    }
  });

  it("serves another league's pages as they are", async () => {
    const response = await proxy(request("/l/football/records"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a signed-out visitor to sign-in, remembering where they were going", async () => {
    const response = await proxy(request("/app/teams?season=spring"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/app/teams?season=spring");
  });

  it("lets a visitor with a session cookie through", async () => {
    const response = await proxy(
      request("/app", "better-auth.session_token=abc.def"),
    );
    expect(response.headers.get("location")).toBeNull();
    // Served from the English tree until the app's screens are translated.
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/app",
    );
  });

  it("keeps a signed-in page's query string, and ignores a language it can't show yet", async () => {
    const response = await proxy(
      request(
        "/app/admin/rules?published=1",
        "better-auth.session_token=a.b; kb_lang=es",
      ),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/app/admin/rules?published=1",
    );
  });

  it("renders a team-filtered schedule from its path segment, keeping the address", async () => {
    const response = await proxy(
      request("/seasons/fall-2026/schedule?team=the-big-kicks"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/l/_default/seasons/fall-2026/schedule/the-big-kicks",
    );
  });

  it("serves the default league's pages from its route tree, keeping the address", async () => {
    for (const [path, target] of [
      ["/", "/en/l/_default"],
      ["/teams/the-big-kicks", "/en/l/_default/teams/the-big-kicks"],
      ["/events/calendar.ics", "/en/l/_default/events/calendar.ics"],
    ] as const) {
      const response = await proxy(request(path));
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.headers.get("x-middleware-rewrite"), path).toBe(
        `http://localhost:3000${target}`,
      );
    }
  });

  it("serves another league's pages at their own address, with its views from the path", async () => {
    const plain = await proxy(request("/l/flag-football/teams/hail-marys"));
    expect(plain.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/l/flag-football/teams/hail-marys",
    );
    const filtered = await proxy(
      request("/l/flag-football/seasons/fall-2026/schedule?team=hail-marys"),
    );
    expect(filtered.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/l/flag-football/seasons/fall-2026/schedule/hail-marys",
    );
  });

  it("sends a typed /l/_default address to the real one", async () => {
    const response = await proxy(request("/l/_default/records?x=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/records?x=1",
    );
  });

  it("serves the site's other pages from the language tree as they are", async () => {
    for (const path of ["/sign-in", "/faq", "/operator"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-rewrite"), path).toBe(
        `http://localhost:3000/en${path}`,
      );
    }
  });

  it("leaves the route handlers outside the language tree alone", async () => {
    for (const path of ["/r/abc123", "/media/photos/x", "/embed/schedule"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-rewrite"), path).toBeNull();
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("sends a typed /en address to the one without a prefix", async () => {
    const response = await proxy(request("/en/faq?q=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/faq?q=1",
    );
  });

  it("sends a language not served yet to the English page", async () => {
    const response = await proxy(request("/es/seasons/fall-2026/schedule"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/seasons/fall-2026/schedule",
    );
  });

  it("shows public pages the paused notice while the site is paused", async () => {
    site.status = "paused";
    const response = await proxy(request("/seasons/fall-2026/schedule"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/paused",
    );
  });

  it("keeps signing in, the app and the operator console reachable while paused", async () => {
    site.status = "paused";
    for (const path of ["/sign-in", "/operator"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-rewrite")).toBe(
        `http://localhost:3000/en${path}`,
      );
    }
    const app = await proxy(request("/app", "better-auth.session_token=a.b"));
    expect(app.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/app",
    );
  });

  it("leaves public pages alone while read-only", async () => {
    site.status = "read_only";
    const response = await proxy(request("/teams/the-big-kicks"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/l/_default/teams/the-big-kicks",
    );
  });

  it("never swaps a league's calendar feed for the paused notice", async () => {
    site.status = "paused";
    const response = await proxy(request("/teams/the-big-kicks/calendar.ics"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/en/l/_default/teams/the-big-kicks/calendar.ics",
    );
  });

  it("runs on every page but not on API routes, build assets or files", () => {
    const [pattern] = config.matcher;
    // Next reads the matcher as a path-to-regexp pattern; this one is also a plain regex.
    const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);
    expect(matches("/")).toBe(true);
    expect(matches("/seasons/fall-2026/schedule")).toBe(true);
    expect(matches("/api/jobs/outbox")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/manifest.webmanifest")).toBe(false);
    // The default league's files are listed one by one, to be rewritten.
    expect(config.matcher).toContain("/teams/:team/calendar.ics");
    expect(config.matcher).toContain("/events/calendar.ics");
  });
});
