import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteStatus } from "@/domain/platform/operator";
import { config, proxy } from "./proxy";

const site: { status: SiteStatus } = vi.hoisted(() => ({ status: "active" }));
vi.mock("@/lib/platform/site", () => ({
  currentSite: async () => ({
    leagueId: "league",
    name: "Test League",
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
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("renders a team-filtered schedule from its path segment, keeping the address", async () => {
    const response = await proxy(
      request("/seasons/fall-2026/schedule?team=the-big-kicks"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/seasons/fall-2026/schedule/the-big-kicks",
    );
  });

  it("lets a public page with no view through untouched, without a session", async () => {
    const response = await proxy(request("/teams/the-big-kicks"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("shows public pages the paused notice while the site is paused", async () => {
    site.status = "paused";
    const response = await proxy(request("/seasons/fall-2026/schedule"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/paused",
    );
  });

  it("keeps signing in, the app and the operator console reachable while paused", async () => {
    site.status = "paused";
    for (const path of ["/sign-in", "/operator"]) {
      const response = await proxy(request(path));
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    const app = await proxy(request("/app", "better-auth.session_token=a.b"));
    expect(app.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves public pages alone while read-only", async () => {
    site.status = "read_only";
    const response = await proxy(request("/teams/the-big-kicks"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
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
  });
});
