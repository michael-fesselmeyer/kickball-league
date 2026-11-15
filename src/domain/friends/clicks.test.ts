import { describe, expect, it } from "vitest";
import { clickPingPath, isLinkPing, recentSince } from "./clicks";

describe("isLinkPing", () => {
  it("counts a browser's link ping", () => {
    expect(isLinkPing(new Headers({ "Content-Type": "text/ping" }))).toBe(true);
    expect(
      isLinkPing(
        new Headers({ "Ping-To": "https://sketch-club.example.test/" }),
      ),
    ).toBe(true);
  });

  it("doesn't count a form or a script posting by hand", () => {
    expect(
      isLinkPing(
        new Headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      ),
    ).toBe(false);
    expect(isLinkPing(new Headers())).toBe(false);
  });
});

describe("recentSince", () => {
  it("covers the last 30 days, today included", () => {
    expect(recentSince(new Date("2026-11-30T18:00:00Z"))).toBe("2026-11-01");
  });
});

describe("clickPingPath", () => {
  it("points at the entry's counter", () => {
    expect(clickPingPath("0b4c2f53-7a5e-4c41-9d0e-3f2a1b6c8d90")).toBe(
      "/api/friends/0b4c2f53-7a5e-4c41-9d0e-3f2a1b6c8d90/click",
    );
  });
});
