import { describe, expect, it } from "vitest";
import { checkinCode, CODE_WINDOW_MS } from "../sponsors/checkin-code";
import {
  attendanceChanges,
  fieldCode,
  fieldCodeKey,
  isCurrentFieldCode,
  markOpen,
  parseMarks,
  parsePlayoffMinGames,
  playoffStanding,
  scanOpen,
} from "./attendance";

const SECRET = "a test auth secret that is long enough";
const GAME = "6a000000-0000-4000-8000-000000000001";
const OTHER = "6a000000-0000-4000-8000-000000000002";
const TZ = "America/New_York";
// 7 pm on Tuesday 10 November 2026 in New York.
const KICKOFF = new Date("2026-11-11T00:00:00Z");
const game = { status: "scheduled", startsAt: KICKOFF, timeZone: TZ };
const at = (iso: string) => new Date(iso);

describe("the field check-in code", () => {
  it("is accepted now and for one window after, then expires", () => {
    const code = fieldCode(SECRET, GAME, KICKOFF);
    expect(isCurrentFieldCode(SECRET, GAME, code, KICKOFF)).toBe(true);
    const next = new Date(KICKOFF.getTime() + CODE_WINDOW_MS);
    expect(isCurrentFieldCode(SECRET, GAME, code, next)).toBe(true);
    const later = new Date(KICKOFF.getTime() + 2 * CODE_WINDOW_MS);
    expect(isCurrentFieldCode(SECRET, GAME, code, later)).toBe(false);
  });

  it("works for its own game only", () => {
    const code = fieldCode(SECRET, GAME, KICKOFF);
    expect(isCurrentFieldCode(SECRET, OTHER, code, KICKOFF)).toBe(false);
    expect(fieldCodeKey(SECRET, GAME)).not.toBe(fieldCodeKey(SECRET, OTHER));
  });

  it("can't be made without the server's secret", () => {
    const code = fieldCode("another secret", GAME, KICKOFF);
    expect(isCurrentFieldCode(SECRET, GAME, code, KICKOFF)).toBe(false);
  });

  it("isn't the code a sponsor or giveaway with the raw secret would show", () => {
    expect(fieldCode(SECRET, GAME, KICKOFF)).not.toBe(
      checkinCode(SECRET, GAME, KICKOFF),
    );
  });

  it("refuses anything that isn't a code", () => {
    for (const bad of ["", "short", "0123456789", "../../etc", "ABCDEFGHJK"])
      expect(isCurrentFieldCode(SECRET, GAME, bad, KICKOFF)).toBe(false);
  });
});

describe("when players can scan in", () => {
  it("is open all of game day in the league's time zone", () => {
    expect(scanOpen(game, at("2026-11-10T05:00:00Z")).ok).toBe(true);
    const open = scanOpen(game, KICKOFF);
    expect(open).toEqual({
      ok: true,
      value: { until: at("2026-11-11T05:00:00Z") },
    });
  });

  it("is closed the day before and after", () => {
    expect(scanOpen(game, at("2026-11-10T04:59:00Z"))).toEqual({
      ok: false,
      error: "not_game_day",
    });
    expect(scanOpen(game, at("2026-11-11T05:00:00Z"))).toEqual({
      ok: false,
      error: "not_game_day",
    });
  });

  it("is closed for a game called off or not placed", () => {
    for (const status of ["cancelled", "postponed"])
      expect(scanOpen({ ...game, status }, KICKOFF)).toEqual({
        ok: false,
        error: "called_off",
      });
    expect(scanOpen({ ...game, startsAt: null }, KICKOFF)).toEqual({
      ok: false,
      error: "called_off",
    });
  });
});

describe("when attendance can be ticked", () => {
  it("opens on game day", () => {
    expect(markOpen(game, at("2026-11-10T04:59:00Z"), false)).toEqual({
      ok: false,
      error: "not_yet",
    });
    expect(markOpen(game, at("2026-11-10T05:00:00Z"), false).ok).toBe(true);
  });

  it("closes for captains and the ref a week after game day, never for admins", () => {
    const lastMinute = at("2026-11-18T04:59:00Z");
    const closed = at("2026-11-18T05:00:00Z");
    expect(markOpen(game, lastMinute, false).ok).toBe(true);
    expect(markOpen(game, closed, false)).toEqual({
      ok: false,
      error: "closed",
    });
    expect(markOpen(game, at("2027-03-01T00:00:00Z"), true).ok).toBe(true);
  });

  it("never opens for a game called off", () => {
    expect(markOpen({ ...game, status: "cancelled" }, KICKOFF, true)).toEqual({
      ok: false,
      error: "called_off",
    });
  });
});

describe("the attendance form", () => {
  const choices = new Set(["u1", "u2", "u3"]);

  it("accepts people in the game, once each", () => {
    const parsed = parseMarks(["u1", "u2", "u1"], choices);
    expect(parsed.ok && [...parsed.value].sort()).toEqual(["u1", "u2"]);
  });

  it("refuses anyone outside the game", () => {
    expect(parseMarks(["u1", "intruder"], choices)).toEqual({
      ok: false,
      error: "unknown_person",
    });
  });

  it("adds the newly ticked and takes off the unticked", () => {
    expect(
      attendanceChanges(new Set(["u1", "u2"]), new Set(["u2", "u3"])),
    ).toEqual({ add: ["u3"], remove: ["u1"] });
    expect(attendanceChanges(new Set(["u1"]), new Set(["u1"]))).toEqual({
      add: [],
      remove: [],
    });
  });
});

describe("the playoff minimum", () => {
  it("is empty for none, or a whole number from 1 to 30", () => {
    expect(parsePlayoffMinGames("")).toEqual({ ok: true, value: null });
    expect(parsePlayoffMinGames(" 3 ")).toEqual({ ok: true, value: 3 });
    expect(parsePlayoffMinGames("30")).toEqual({ ok: true, value: 30 });
    for (const bad of ["0", "31", "2.5", "-1", "three"])
      expect(parsePlayoffMinGames(bad).ok).toBe(false);
  });

  it("says who is eligible and how many games others are short", () => {
    expect(playoffStanding(3, 3)).toEqual({ eligible: true, short: 0 });
    expect(playoffStanding(5, 3)).toEqual({ eligible: true, short: 0 });
    expect(playoffStanding(1, 3)).toEqual({ eligible: false, short: 2 });
    expect(playoffStanding(0, null)).toBeNull();
  });
});
