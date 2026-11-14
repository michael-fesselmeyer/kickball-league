import { describe, expect, it } from "vitest";
import { localDate } from "../scheduler/slots";
import { localTime } from "../time/zoned";
import {
  addDays,
  daysBetween,
  planRollover,
  shiftInstant,
  type SourceSeason,
  type SourceTeam,
  type SourceWindow,
  suggestedName,
  suggestedStart,
} from "./rollover";

const NY = "America/New_York";

const source: SourceSeason = {
  name: "Fall 2026",
  startsOn: "2026-09-08",
  endsOn: "2026-11-10",
  feeModel: "per_player",
  teamFeeCents: null,
  playerFeeCents: 8500,
  freeAgentFeeCents: 8500,
  earlyBirdEndsAt: new Date("2026-08-01T03:59:00Z"),
  earlyBirdDiscountCents: 1000,
  registrationOpensAt: new Date("2026-07-01T04:00:00Z"),
  registrationClosesAt: new Date("2026-08-31T03:59:00Z"),
  paymentDeadlineAt: null,
  maxTeams: 12,
  rosterMin: 12,
  rosterMax: 20,
  gamesPerTeamPerDay: 1,
};

const team = (
  id: string,
  status: string,
  captains: SourceTeam["captains"] = [],
): SourceTeam => ({
  teamSeasonId: id,
  teamId: `team-${id}`,
  name: `Team ${id}`,
  status,
  divisionId: null,
  captains,
});

describe("shifting dates", () => {
  it("moves dates by whole days, across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-09-08", "2027-03-02")).toBe(175);
    expect(daysBetween("2027-03-02", "2026-09-08")).toBe(-175);
  });

  it("keeps the wall-clock time across a daylight-saving change", () => {
    // 8 pm on a summer Tuesday (EDT, UTC-4) …
    const summer = new Date("2026-09-09T00:00:00Z");
    expect(localTime(summer, NY)).toBe("20:00");
    // … lands at 8 pm on a winter Tuesday (EST, UTC-5): an hour later in UTC.
    const winter = shiftInstant(summer, 28 * 7, NY);
    expect(winter.toISOString()).toBe("2027-03-24T00:00:00.000Z");
    expect(localDate(winter, NY)).toBe("2027-03-23");
    expect(localTime(winter, NY)).toBe("20:00");
    // And back again into summer time.
    const back = shiftInstant(new Date("2027-02-03T01:00:00Z"), 56, NY);
    expect(localTime(back, NY)).toBe("20:00");
    expect(back.toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });

  it("keeps 11:59 pm deadlines at 11:59 pm", () => {
    // 11:59 pm on Sunday, August 30, in New York.
    const deadline = new Date("2026-08-31T03:59:00Z");
    const moved = shiftInstant(deadline, 182, NY);
    expect(localDate(moved, NY)).toBe("2027-02-28");
    expect(localTime(moved, NY)).toBe("23:59");
  });
});

describe("suggestions", () => {
  it("starts on the first same weekday after the season ends", () => {
    // 2026-09-08 is a Tuesday; the season ends Tuesday 2026-11-10.
    expect(suggestedStart("2026-09-08", "2026-11-10")).toBe("2026-11-17");
    expect(suggestedStart("2026-09-08", "2026-11-12")).toBe("2026-11-17");
  });

  it("moves a year in the name when the season moves a year", () => {
    expect(suggestedName("Fall 2026", 364)).toBe("Fall 2027");
    expect(suggestedName("Spring 2027", 70)).toBe("Spring 2027 (next)");
    expect(suggestedName("Monday league", 364)).toBe("Monday league (next)");
  });
});

describe("planRollover", () => {
  const teams = [
    team("a", "confirmed", [
      { userId: "u1", name: "Casey Captain", role: "captain" },
      { userId: "u2", name: "Robin Co", role: "co_captain" },
    ]),
    team("b", "pending_payment", [
      { userId: "u3", name: "Jordan Lead", role: "captain" },
    ]),
    team("c", "waitlisted"),
  ];
  const windows: SourceWindow[] = [
    {
      id: "w1",
      fieldId: "f1",
      fieldName: "Field 1",
      startsAt: new Date("2026-09-09T00:00:00Z"),
      endsAt: new Date("2026-09-09T02:00:00Z"),
      status: "confirmed",
    },
    {
      id: "w2",
      fieldId: "f1",
      fieldName: "Field 1",
      startsAt: new Date("2026-09-16T00:00:00Z"),
      endsAt: new Date("2026-09-16T02:00:00Z"),
      status: "lost",
    },
  ];

  it("shifts every date and copies the chosen teams with their captains", () => {
    const plan = planRollover(
      source,
      teams,
      windows,
      {
        name: "Spring 2027",
        startsOn: "2027-03-23",
        teamIds: new Set(["a", "b"]),
      },
      NY,
    );
    if (!plan.ok) throw new Error(plan.error);
    const p = plan.value;
    expect(p.days).toBe(196);
    expect(p.slug).toBe("spring-2027");
    expect(p.dates.startsOn).toBe("2027-03-23");
    expect(p.dates.endsOn).toBe("2027-05-25");
    expect(p.dates.paymentDeadlineAt).toBeNull();
    // Registration opened at midnight in July; it opens at midnight in January.
    const opens = p.dates.registrationOpensAt;
    if (!opens) throw new Error("no opening");
    expect(localDate(opens, NY)).toBe("2027-01-13");
    expect(localTime(opens, NY)).toBe("00:00");
    expect(p.teams.map((t) => t.teamSeasonId)).toEqual(["a", "b"]);
    expect(p.captainCount).toBe(3);
    // The lost window is not asked for again; the other keeps 8 to 10 pm.
    expect(p.windows.map((w) => w.id)).toEqual(["w1"]);
    const [w] = p.windows;
    if (!w) throw new Error("no window");
    expect(localDate(w.newStartsAt, NY)).toBe("2027-03-23");
    expect(localTime(w.newStartsAt, NY)).toBe("20:00");
    expect(localTime(w.newEndsAt, NY)).toBe("22:00");
  });

  it("names what is wrong with the choice", () => {
    const choose = (name: string, startsOn: string) =>
      planRollover(
        source,
        teams,
        windows,
        { name, startsOn, teamIds: new Set() },
        NY,
      );
    expect(choose("  ", "2027-03-23")).toEqual({ ok: false, error: "name" });
    expect(choose("Spring", "next spring")).toEqual({
      ok: false,
      error: "date",
    });
    expect(choose("Spring", "2026-09-08")).toEqual({
      ok: false,
      error: "same_dates",
    });
    const none = choose("Spring", "2027-03-23");
    expect(none.ok && none.value.teams).toEqual([]);
  });
});
