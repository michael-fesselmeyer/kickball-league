import { describe, expect, it } from "vitest";
import {
  describeBlocker,
  fillProfile,
  mergedEmail,
  normalizeEmail,
  registrationToKeep,
  roleBlocks,
  signatureToKeep,
} from "./rules";

describe("conflict choices", () => {
  it("keeps the registration that has something on it", () => {
    expect(registrationToKeep({ empty: false }, { empty: true })).toBe("kept");
    expect(registrationToKeep({ empty: true }, { empty: false })).toBe(
      "merged",
    );
    expect(registrationToKeep({ empty: true }, { empty: true })).toBe("kept");
    expect(registrationToKeep({ empty: false }, { empty: false })).toBe(
      "blocked",
    );
  });

  it("keeps the earliest waiver signature", () => {
    const early = { signedAt: new Date("2027-01-01T00:00:00Z") };
    const late = { signedAt: new Date("2027-02-01T00:00:00Z") };
    expect(signatureToKeep(late, early)).toBe("merged");
    expect(signatureToKeep(early, late)).toBe("kept");
    expect(signatureToKeep(early, early)).toBe("kept");
  });

  it("refuses to merge away a higher role", () => {
    expect(roleBlocks("player", "admin")).toBe(true);
    expect(roleBlocks("admin", "owner")).toBe(true);
    expect(roleBlocks("owner", "admin")).toBe(false);
    expect(roleBlocks("player", "player")).toBe(false);
  });

  it("fills only the kept profile's empty fields", () => {
    type Row = Record<"phone" | "shirt" | "birth", string | null>;
    const kept: Row = { phone: null, shirt: "m", birth: null };
    const merged: Row = { phone: "+15555550101", shirt: "l", birth: null };
    expect(fillProfile(kept, merged, ["phone", "shirt", "birth"])).toEqual({
      phone: "+15555550101",
    });
  });

  it("gives the merged-away account an address that cannot receive mail", () => {
    expect(mergedEmail("abc")).toBe("merged-abc@deleted.invalid");
    expect(normalizeEmail("  Pat@Example.TEST ")).toBe("pat@example.test");
  });

  it("explains every blocker", () => {
    for (const b of [
      { kind: "same_account" },
      { kind: "acting_admin" },
      { kind: "already_merged", which: "kept" },
      { kind: "already_merged", which: "merged" },
      { kind: "higher_role", role: "owner" },
      { kind: "both_registered", season: "Spring 2027" },
      { kind: "both_rebated", season: "Fall 2026" },
    ] as const)
      expect(describeBlocker(b).length).toBeGreaterThan(10);
  });
});
