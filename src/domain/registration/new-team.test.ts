import { describe, expect, it } from "vitest";
import { parseDeclineReason, parseNewTeamRequest } from "./new-team";

const season = {
  rosterMin: 12,
  rosterMax: 20,
  feeModel: "per_team" as const,
};
const fields = {
  name: "  Kick   Bottom ",
  expectedSize: "14",
  paymentMode: "split",
  note: "  Six of us from the Tuesday pickup game.  ",
};

describe("parseNewTeamRequest", () => {
  it("tidies the name and note", () => {
    expect(parseNewTeamRequest(fields, season)).toEqual({
      ok: true,
      value: {
        name: "Kick Bottom",
        expectedSize: 14,
        paymentMode: "split",
        note: "Six of us from the Tuesday pickup game.",
      },
    });
  });

  it("keeps a blank note as none", () => {
    const parsed = parseNewTeamRequest({ ...fields, note: "   " }, season);
    expect(parsed.ok && parsed.value.note).toBeNull();
  });

  it("refuses names with no letters or digits, or too long", () => {
    for (const name of ["", " ", "!!!", "x".repeat(41)])
      expect(parseNewTeamRequest({ ...fields, name }, season)).toEqual({
        ok: false,
        error: "bad_name",
      });
  });

  it("keeps the expected size within the season's roster limits", () => {
    for (const expectedSize of ["11", "21", "14.5", "", "many"])
      expect(parseNewTeamRequest({ ...fields, expectedSize }, season)).toEqual({
        ok: false,
        error: "bad_size",
      });
    expect(
      parseNewTeamRequest({ ...fields, expectedSize: "20" }, season).ok,
    ).toBe(true);
  });

  it("refuses a note over 500 characters", () => {
    expect(
      parseNewTeamRequest({ ...fields, note: "x".repeat(501) }, season),
    ).toEqual({ ok: false, error: "note_too_long" });
  });

  it("splits unless the captain chooses to pay it all", () => {
    const mode = (paymentMode: string) => {
      const parsed = parseNewTeamRequest({ ...fields, paymentMode }, season);
      return parsed.ok ? parsed.value.paymentMode : null;
    };
    expect(mode("full")).toBe("full");
    expect(mode("split")).toBe("split");
    expect(mode("")).toBe("split");
  });

  it("has nothing to split when everyone pays their own fee", () => {
    const parsed = parseNewTeamRequest(fields, {
      ...season,
      feeModel: "per_player",
    });
    expect(parsed.ok && parsed.value.paymentMode).toBe("full");
  });
});

describe("parseDeclineReason", () => {
  it("trims, keeps blank as none, and caps the length", () => {
    expect(parseDeclineReason("  Full this season.  ")).toEqual({
      ok: true,
      value: "Full this season.",
    });
    expect(parseDeclineReason("  ")).toEqual({ ok: true, value: null });
    expect(parseDeclineReason("x".repeat(501))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
  });
});
