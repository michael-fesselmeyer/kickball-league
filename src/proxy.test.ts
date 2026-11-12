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

  it("only runs on /app and below", () => {
    expect(config.matcher).toEqual(["/app", "/app/:path*"]);
  });
});
