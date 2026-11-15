import { describe, expect, it } from "vitest";
import {
  type CoverWindow,
  coverageGap,
  gapSentence,
  OVERRIDE_REASON_MAX,
  parseOverrideReason,
  usable,
  waiveDocuments,
} from "./coverage";

const NY = "America/New_York";
/** EDT wall-clock on Tuesday, Sep 15, 2026, as an ISO string. */
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 15, hour + 4, minute)).toISOString();

const window = (
  from: number,
  to: number,
  extra: Partial<CoverWindow> = {},
): CoverWindow => ({
  fieldId: "f3",
  startsAt: at(from),
  endsAt: at(to),
  status: "confirmed",
  hasDocument: true,
  ...extra,
});

const game = (
  from: [number, number],
  to: [number, number],
  fieldId = "f3",
) => ({
  fieldId,
  startsAt: at(...from),
  endsAt: at(...to),
});

describe("coverageGap", () => {
  it("is covered inside one window, edges included", () => {
    expect(coverageGap(game([18, 0], [20, 0]), [window(18, 20)])).toBeNull();
    expect(coverageGap(game([19, 0], [19, 50]), [window(18, 20)])).toBeNull();
  });

  it("joins windows that touch or overlap", () => {
    expect(
      coverageGap(game([19, 0], [21, 0]), [window(18, 20), window(20, 22)]),
    ).toBeNull();
    expect(
      coverageGap(game([19, 0], [21, 30]), [window(20, 22), window(18, 21)]),
    ).toBeNull();
  });

  it("says when the permit ends before the game does", () => {
    expect(coverageGap(game([19, 0], [20, 20]), [window(18, 20)])).toEqual({
      kind: "ends_late",
      permittedUntil: new Date(at(20)),
    });
  });

  it("says when the permit starts after the game does", () => {
    expect(coverageGap(game([17, 30], [18, 30]), [window(18, 20)])).toEqual({
      kind: "starts_early",
      permittedFrom: new Date(at(18)),
    });
  });

  it("finds the gap between two windows that don't touch", () => {
    expect(
      coverageGap(game([19, 30], [20, 30]), [
        window(18, 20),
        window(20, 22, { startsAt: at(20, 15) }),
      ]),
    ).toEqual({ kind: "ends_late", permittedUntil: new Date(at(20)) });
  });

  it("only counts the game's own field", () => {
    expect(coverageGap(game([18, 0], [19, 0], "f2"), [window(18, 20)])).toEqual(
      { kind: "no_permit" },
    );
  });

  it("does not count a lost window, and says so", () => {
    expect(
      coverageGap(game([18, 0], [19, 0]), [window(18, 20, { status: "lost" })]),
    ).toEqual({ kind: "lost" });
  });

  it("does not count a window without its document, and says so first", () => {
    expect(
      coverageGap(game([18, 0], [19, 0]), [
        window(18, 20, { hasDocument: false }),
        window(18, 20, { status: "lost" }),
      ]),
    ).toEqual({ kind: "no_document" });
  });

  it("counts a requested window that has its document", () => {
    expect(
      coverageGap(game([18, 0], [19, 0]), [
        window(18, 20, { status: "requested" }),
      ]),
    ).toBeNull();
  });

  it("takes Dates as well as strings", () => {
    expect(
      coverageGap(
        { fieldId: "f3", startsAt: new Date(at(18)), endsAt: new Date(at(19)) },
        [
          window(18, 20, {
            startsAt: new Date(at(18)),
            endsAt: new Date(at(20)),
          }),
        ],
      ),
    ).toBeNull();
  });

  it("calls nothing at all no permit", () => {
    expect(coverageGap(game([18, 0], [19, 0]), [])).toEqual({
      kind: "no_permit",
    });
  });
});

describe("usable", () => {
  it("needs a document and not lost", () => {
    expect(usable(window(1, 2))).toBe(true);
    expect(usable(window(1, 2, { hasDocument: false }))).toBe(false);
    expect(usable(window(1, 2, { status: "lost" }))).toBe(false);
  });
});

describe("gapSentence", () => {
  const item = {
    fieldName: "Field 3",
    startsAt: at(19),
    endsAt: at(20, 20),
    noun: "game",
  };

  it("names the permit's end and the game's", () => {
    expect(
      gapSentence(
        { kind: "ends_late", permittedUntil: new Date(at(20)) },
        item,
        NY,
      ),
    ).toBe("Field 3 is permitted until 8:00 PM; this game ends at 8:20 PM.");
  });

  it("names the permit's start and the item's", () => {
    expect(
      gapSentence(
        { kind: "starts_early", permittedFrom: new Date(at(19, 30)) },
        { ...item, noun: "pickup" },
        NY,
      ),
    ).toBe("Field 3 is permitted from 7:30 PM; this pickup starts at 7:00 PM.");
  });

  it("explains a missing document, a lost permit and no permit", () => {
    expect(gapSentence({ kind: "no_document" }, item, NY)).toBe(
      "Field 3's permit for that time has no document uploaded yet; an owner adds it on the permits screen.",
    );
    expect(gapSentence({ kind: "lost" }, item, NY)).toBe(
      "Field 3's permit for that time was marked lost.",
    );
    expect(gapSentence({ kind: "no_permit" }, item, NY)).toBe(
      "No permit covers Field 3 on Tue, Sep 15 from 7:00 PM to 8:20 PM.",
    );
  });
});

describe("overriding missing documents (ADR 0066)", () => {
  it("counts windows without their document, never lost ones", () => {
    const windows = waiveDocuments([
      window(18, 20, { hasDocument: false }),
      window(20, 22, { status: "lost", hasDocument: false }),
    ]);
    expect(coverageGap(game([18, 0], [19, 0]), windows)).toBeNull();
    expect(coverageGap(game([20, 0], [21, 0]), windows)).toEqual({
      kind: "lost",
    });
  });

  it("needs a reason of a sensible length", () => {
    expect(parseOverrideReason("  Permit 1234   issued, PDF Monday ")).toEqual({
      ok: true,
      value: "Permit 1234 issued, PDF Monday",
    });
    expect(parseOverrideReason("ok")).toEqual({
      ok: false,
      error: "reason_short",
    });
    expect(parseOverrideReason(null)).toEqual({
      ok: false,
      error: "reason_short",
    });
    expect(parseOverrideReason("x".repeat(OVERRIDE_REASON_MAX + 1))).toEqual({
      ok: false,
      error: "reason_long",
    });
  });
});
