import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(
    `http://localhost:3000${path}`,
    cookie ? { headers: { cookie } } : {},
  );

describe("proxy", () => {
  it("sends a signed-out visitor to sign-in, remembering where they were going", () => {
    const response = proxy(request("/app/teams?season=spring"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/app/teams?season=spring");
  });

  it("lets a visitor with a session cookie through", () => {
    const response = proxy(
      request("/app", "better-auth.session_token=abc.def"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("renders a team-filtered schedule from its path segment, keeping the address", () => {
    const response = proxy(
      request("/seasons/fall-2026/schedule?team=the-big-kicks"),
    );
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost:3000/seasons/fall-2026/schedule/the-big-kicks",
    );
  });

  it("lets a public page with no view through untouched, without a session", () => {
    const response = proxy(request("/teams/the-big-kicks"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("runs only on /app and the public pages that pick a view", () => {
    expect(config.matcher).toEqual([
      "/app",
      "/app/:path*",
      "/seasons/:season/schedule",
      "/teams/:team",
    ]);
  });
});
