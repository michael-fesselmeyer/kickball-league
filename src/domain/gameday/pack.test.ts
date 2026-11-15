import { describe, expect, it } from "vitest";
import {
  checkInName,
  fieldSheets,
  type PackRow,
  permitLine,
  teamsPlaying,
} from "./pack";

const at = (hhmm: string) => new Date(`2026-07-12T${hhmm}:00Z`);

const row = (over: Partial<PackRow>): PackRow => ({
  id: "g1",
  startsAt: at("23:00"),
  fieldId: "f1",
  fieldName: "Field 1",
  venueName: "McCarren Park",
  teamA: "Pitch Please",
  teamB: "Foul Play",
  teamAId: "t1",
  teamBId: "t2",
  kicksFirst: null,
  referee: "Jo S.",
  calledOff: false,
  permit: { number: "M-0412", status: "confirmed", onFile: true },
  ...over,
});

describe("fieldSheets", () => {
  it("makes a sheet per field, fields by first kickoff, games in order", () => {
    const sheets = fieldSheets([
      row({ id: "late-1", startsAt: at("01:00"), fieldId: "f1" }),
      row({
        id: "early-2",
        startsAt: at("00:00"),
        fieldId: "f2",
        fieldName: "Field 2",
      }),
      row({ id: "early-1", startsAt: at("00:00"), fieldId: "f1" }),
    ]);
    expect(sheets.map((s) => s.fieldName)).toEqual(["Field 1", "Field 2"]);
    expect(sheets[0]?.games.map((g) => g.id)).toEqual(["early-1", "late-1"]);
  });

  it("lists the team that kicks first on the top row", () => {
    const [sheet] = fieldSheets([row({ kicksFirst: "B" })]);
    expect(sheet?.games[0]).toMatchObject({
      first: "Foul Play",
      second: "Pitch Please",
    });
  });

  it("names each permit once, and flags a game with none", () => {
    const [sheet] = fieldSheets([
      row({
        id: "a",
        permit: { number: "M-0412", status: "confirmed", onFile: false },
      }),
      row({
        id: "b",
        permit: { number: "M-0412", status: "confirmed", onFile: true },
      }),
      row({ id: "c", permit: null }),
    ]);
    expect(sheet?.permits).toEqual([
      { number: "M-0412", status: "confirmed", onFile: true },
    ]);
    expect(sheet?.unpermitted).toBe(true);
  });
});

describe("permitLine", () => {
  it("says whether the permit is on file", () => {
    expect(
      permitLine({ number: "M-0412", status: "confirmed", onFile: true }),
    ).toBe(
      "Permit M-0412. Permit on file: the ref and captains can open it in the app.",
    );
    expect(
      permitLine({ number: null, status: "requested", onFile: false }),
    ).toBe(
      "A permit (requested, not confirmed yet). No copy of the permit on file yet.",
    );
  });

  it("warns about a lost permit", () => {
    expect(permitLine({ number: "M-0412", status: "lost", onFile: true })).toBe(
      "Permit M-0412 was lost. Check with an admin before play.",
    );
  });
});

describe("teamsPlaying", () => {
  it("lists each team once, by name, leaving out called-off games", () => {
    expect(
      teamsPlaying([
        row({}),
        row({
          id: "g2",
          teamA: "Ace Kickers",
          teamAId: "t3",
          teamB: "Foul Play",
        }),
        row({
          id: "g3",
          teamA: "Rained Out",
          teamAId: "t9",
          teamBId: "t8",
          teamB: "Also Out",
          calledOff: true,
        }),
      ]),
    ).toEqual([
      { id: "t3", name: "Ace Kickers" },
      { id: "t2", name: "Foul Play" },
      { id: "t1", name: "Pitch Please" },
    ]);
  });
});

describe("checkInName", () => {
  it("is first name and last initial", () => {
    expect(checkInName("Robin", "Quill", null)).toBe("Robin Q.");
    expect(checkInName("Robin", null, "Robin Quill")).toBe("Robin");
  });

  it("cuts an account name to the same shape when the profile has none", () => {
    expect(checkInName(null, null, "Sam de la Cruz")).toBe("Sam C.");
    expect(checkInName(null, null, "Sam")).toBe("Sam");
    expect(checkInName(null, null, "  ")).toBe("A player");
  });
});
