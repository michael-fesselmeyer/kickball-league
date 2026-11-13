import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  CODE_WINDOW_MS,
  checkinCode,
  codeTurnsOverAt,
  isCurrentCheckinCode,
  newCheckinSecret,
} from "./checkin-code";

const SECRET = "a".repeat(64);
const SPONSOR = "5b1f0000-0000-4000-8000-000000000001";
const AT = new Date("2026-11-10T23:31:00Z");

describe("the rotating check-in code", () => {
  it("is short, readable and the same within a window", () => {
    const code = checkinCode(SECRET, SPONSOR, AT);
    expect(code).toMatch(new RegExp(`^[a-z2-9]{${CODE_LENGTH}}$`));
    expect(code).not.toMatch(/[ilo01]/);
    const sameWindow = new Date(codeTurnsOverAt(AT).getTime() - 1);
    expect(checkinCode(SECRET, SPONSOR, sameWindow)).toBe(code);
  });

  it("changes when the window turns over", () => {
    expect(checkinCode(SECRET, SPONSOR, codeTurnsOverAt(AT))).not.toBe(
      checkinCode(SECRET, SPONSOR, AT),
    );
  });

  it("is accepted for the current window and the one before, not after", () => {
    const code = checkinCode(SECRET, SPONSOR, AT);
    const next = codeTurnsOverAt(AT);
    expect(isCurrentCheckinCode(SECRET, SPONSOR, code, AT)).toBe(true);
    expect(isCurrentCheckinCode(SECRET, SPONSOR, code, next)).toBe(true);
    expect(
      isCurrentCheckinCode(
        SECRET,
        SPONSOR,
        code,
        new Date(next.getTime() + CODE_WINDOW_MS),
      ),
    ).toBe(false);
  });

  it("does not accept a code made ahead of time", () => {
    const later = checkinCode(
      SECRET,
      SPONSOR,
      new Date(AT.getTime() + CODE_WINDOW_MS),
    );
    expect(isCurrentCheckinCode(SECRET, SPONSOR, later, AT)).toBe(false);
  });

  it("belongs to one sponsor and one secret", () => {
    const code = checkinCode(SECRET, SPONSOR, AT);
    expect(
      isCurrentCheckinCode(SECRET, SPONSOR.replace(/1$/, "2"), code, AT),
    ).toBe(false);
    expect(isCurrentCheckinCode("b".repeat(64), SPONSOR, code, AT)).toBe(false);
  });

  it("rejects anything that is not a code without throwing", () => {
    fc.assert(
      fc.property(fc.string(), (junk) => {
        expect(typeof isCurrentCheckinCode(SECRET, SPONSOR, junk, AT)).toBe(
          "boolean",
        );
      }),
    );
  });

  it("makes a long random secret each time", () => {
    const a = newCheckinSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newCheckinSecret()).not.toBe(a);
  });
});
