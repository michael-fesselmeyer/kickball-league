import { describe, expect, it } from "vitest";
import {
  hashInviteToken,
  inviteExpiry,
  looksLikeInviteToken,
  newInviteToken,
} from "./token";

describe("invite tokens", () => {
  it("are random, URL-safe and recognisable", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(looksLikeInviteToken(a)).toBe(true);
    expect(encodeURIComponent(a)).toBe(a);
    for (const bad of ["", "short", `${a}x`, `${a.slice(0, 42)}/`])
      expect(looksLikeInviteToken(bad)).toBe(false);
  });

  it("hash to 64 hex characters, the same each time", () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(newInviteToken()));
  });

  it("expire after 30 days by default", () => {
    const now = new Date("2027-02-01T00:00:00Z");
    expect(inviteExpiry(now).toISOString()).toBe("2027-03-03T00:00:00.000Z");
    expect(inviteExpiry(now, 1).toISOString()).toBe("2027-02-02T00:00:00.000Z");
  });
});
