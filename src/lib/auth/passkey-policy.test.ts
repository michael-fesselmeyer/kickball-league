import { describe, expect, it } from "vitest";
import { SESSION_FRESH_AGE_SECONDS } from "./config";
import { passkeyRegistrationRefusal, relyingParty } from "./passkey-policy";

const NOW = new Date("2026-11-12T20:00:00Z");
const fresh = new Date(NOW.getTime() - 60_000);
const stale = new Date(NOW.getTime() - (SESSION_FRESH_AGE_SECONDS + 1) * 1000);
const base = { now: NOW, writable: true };

describe("passkeyRegistrationRefusal", () => {
  it("lets a freshly signed-in player add a passkey", () => {
    expect(passkeyRegistrationRefusal({ ...base, signedInAt: fresh })).toBe(
      null,
    );
  });

  it("asks an older session to confirm it's them first", () => {
    expect(passkeyRegistrationRefusal({ ...base, signedInAt: stale })).toBe(
      "stale",
    );
  });

  it("refuses signed-out visitors and a frozen site", () => {
    expect(passkeyRegistrationRefusal({ ...base, signedInAt: null })).toBe(
      "signed_out",
    );
    expect(
      passkeyRegistrationRefusal({
        ...base,
        signedInAt: fresh,
        writable: false,
      }),
    ).toBe("frozen");
  });
});

describe("relyingParty", () => {
  it("is the site's host name and origin", () => {
    expect(relyingParty("https://kickball.example.test/")).toEqual({
      rpID: "kickball.example.test",
      origin: "https://kickball.example.test",
    });
    expect(relyingParty("http://localhost:3029")).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3029",
    });
  });
});
