import { describe, expect, it } from "vitest";
import { AppUrlError, appBoundDomains, resolveAppUrl } from "./app-url";

describe("resolveAppUrl", () => {
  it("takes an https site and keeps only its origin", () => {
    expect(resolveAppUrl(" https://league.example.test/ ")).toEqual({
      origin: "https://league.example.test",
      hostname: "league.example.test",
      cleartext: false,
    });
  });

  it("allows plain http only for a dev server on the loopback address", () => {
    expect(resolveAppUrl("http://localhost:3000")).toEqual({
      origin: "http://localhost:3000",
      hostname: "localhost",
      cleartext: true,
    });
    expect(resolveAppUrl("http://127.0.0.1:3100").cleartext).toBe(true);
    // An emulator's alias for the host is not a secure context, so the
    // service worker would not run: adb reverse keeps localhost instead.
    expect(() => resolveAppUrl("http://10.0.2.2:3000")).toThrow(AppUrlError);
    expect(() => resolveAppUrl("http://league.example.test")).toThrow(
      /must use https/,
    );
  });

  it("asks for the setting when it is missing", () => {
    expect(() => resolveAppUrl(undefined)).toThrow(/Set MOBILE_APP_URL/);
    expect(() => resolveAppUrl("   ")).toThrow(/Set MOBILE_APP_URL/);
  });

  it("refuses anything but a bare web origin", () => {
    expect(() => resolveAppUrl("league.example.test")).toThrow(
      /not a web address/,
    );
    expect(() => resolveAppUrl("https://league.example.test/app")).toThrow(
      /origin alone/,
    );
    expect(() => resolveAppUrl("https://league.example.test/?a=1")).toThrow(
      /origin alone/,
    );
    expect(() => resolveAppUrl("https://user:pw@league.example.test")).toThrow(
      /user name or password/,
    );
    expect(() => resolveAppUrl("ftp://league.example.test")).toThrow(
      /http\(s\)/,
    );
    expect(() => resolveAppUrl("javascript:alert(1)")).toThrow(AppUrlError);
  });
});

describe("appBoundDomains", () => {
  it("names the site and the shell's own localhost", () => {
    expect(
      appBoundDomains(resolveAppUrl("https://league.example.test")),
    ).toEqual(["league.example.test", "localhost"]);
  });

  it("names localhost once for a dev server", () => {
    expect(appBoundDomains(resolveAppUrl("http://localhost:3000"))).toEqual([
      "localhost",
    ]);
    expect(appBoundDomains(resolveAppUrl("http://[::1]:3000"))).toEqual([
      "::1",
      "localhost",
    ]);
  });
});
