import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  AUDIENCES,
  canSee,
  clearsAt,
  isActive,
  isRecruiting,
  NOTE_MAX,
  readAudience,
  readMessage,
  readNote,
  revealsName,
} from "./move";

const at = (iso: string) => new Date(iso);

describe("looking for a change", () => {
  it("reads the note and pitch: trimmed, empty as none, capped", () => {
    expect(readNote("  Tuesdays  ")).toEqual(ok("Tuesdays"));
    expect(readNote("   ")).toEqual(ok(null));
    expect(readNote(undefined)).toEqual(ok(null));
    expect(readNote("x".repeat(NOTE_MAX))).toEqual(ok("x".repeat(NOTE_MAX)));
    expect(readNote("x".repeat(NOTE_MAX + 1))).toEqual(err("note_too_long"));
    expect(readMessage("x".repeat(301))).toEqual(err("message_too_long"));
  });

  it("accepts only the three audiences", () => {
    for (const a of AUDIENCES) expect(readAudience(a)).toBe(a);
    expect(readAudience("everyone")).toBeNull();
    expect(readAudience(null)).toBeNull();
  });

  it("clears at the first registration close after it was set", () => {
    const set = at("2026-10-01T00:00:00Z");
    const closes = [
      at("2026-08-25T00:00:00Z"), // this season's, already past
      at("2027-06-01T00:00:00Z"),
      at("2027-02-01T00:00:00Z"), // next season's
    ];
    expect(clearsAt(set, closes)).toEqual(at("2027-02-01T00:00:00Z"));
    expect(isActive(set, closes, at("2027-01-31T23:59:59Z"))).toBe(true);
    expect(isActive(set, closes, at("2027-02-01T00:00:00Z"))).toBe(false);
    // With no season ahead, it waits for one.
    expect(clearsAt(set, closes.slice(0, 1))).toBeNull();
    expect(isActive(set, closes.slice(0, 1), at("2030-01-01T00:00:00Z"))).toBe(
      true,
    );
  });

  it("is never seen by a team the player has played for, whatever the audience", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AUDIENCES),
        fc.boolean(),
        (audience, keptOff) => {
          expect(
            canSee(audience, {
              kind: "recruiting_captain",
              playedForTeam: true,
              keptOff,
            }),
          ).toBe(false);
        },
      ),
    );
  });

  it("follows the audience for admins and other teams' captains", () => {
    const other = {
      kind: "recruiting_captain",
      playedForTeam: false,
      keptOff: false,
    } as const;
    expect(canSee("admins", { kind: "admin" })).toBe(true);
    expect(canSee("captains", { kind: "admin" })).toBe(false);
    expect(canSee("both", { kind: "admin" })).toBe(true);
    expect(canSee("admins", other)).toBe(false);
    expect(canSee("captains", other)).toBe(true);
    expect(canSee("both", { ...other, keptOff: true })).toBe(false);
    for (const a of AUDIENCES) {
      expect(canSee(a, { kind: "self" })).toBe(true);
      expect(canSee(a, { kind: "other" })).toBe(false);
    }
  });

  it("names the player to a team only after a yes, while captains may see it", () => {
    expect(revealsName("pending", "both")).toBe(false);
    expect(revealsName("declined", "both")).toBe(false);
    expect(revealsName("accepted", "both")).toBe(true);
    expect(revealsName("accepted", "captains")).toBe(true);
    expect(revealsName("accepted", "admins")).toBe(false);
  });

  it("recruits only before next season's registration closes", () => {
    const now = at("2026-10-01T00:00:00Z");
    expect(isRecruiting("registration_open", null, now)).toBe(true);
    expect(isRecruiting("draft", at("2027-01-01T00:00:00Z"), now)).toBe(true);
    expect(isRecruiting("registration_open", at("2026-09-01T00:00:00Z"), now)).toBe(false);
    expect(isRecruiting("in_progress", null, now)).toBe(false);
  });
});
