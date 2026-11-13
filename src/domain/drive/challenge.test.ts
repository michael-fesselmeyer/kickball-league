import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  challengeFormValues,
  challengeLeader,
  parseChallengeForm,
  progressLine,
  rankTeams,
  type RosterSpot,
  teamProgress,
} from "./challenge";

const at = (minute: number) => new Date(Date.UTC(2027, 2, 1, 12, minute));
const DEADLINE = at(500);

const spot = (joined: number, signed: number | null): RosterSpot => ({
  joinedAt: at(joined),
  signedAt: signed === null ? null : at(signed),
});

describe("a team's sign-up progress", () => {
  it("counts players who joined and signed, out of the expected roster", () => {
    const p = teamProgress([spot(1, 2), spot(3, null), spot(4, 5)], 12);
    expect(p).toMatchObject({ signedUp: 2, of: 12, percent: 16 });
    expect(p.completedAt).toBeNull();
    expect(progressLine(p)).toBe("2 of 12 signed up");
  });

  it("counts a roster bigger than the target in full", () => {
    expect(teamProgress([spot(1, 2), spot(1, 2), spot(1, null)], 2).of).toBe(3);
  });

  it("is complete only at the expected size, at the last sign-up", () => {
    const small = teamProgress([spot(1, 2), spot(3, 4)], 10);
    expect(small.completedAt).toBeNull();
    const full = teamProgress([spot(1, 9), spot(7, 3), spot(2, 4)], 3);
    expect(full.percent).toBe(100);
    // The last to finish signed at minute 9; one joined at 7 but signed earlier.
    expect(full.completedAt).toEqual(at(9));
  });

  it("never reads 100% before everyone has signed up", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(100), fc.option(fc.nat(100))), {
          maxLength: 30,
        }),
        fc.integer({ min: 1, max: 30 }),
        (raw, expected) => {
          const p = teamProgress(
            raw.map(([j, s]) => spot(j, s)),
            expected,
          );
          expect(p.signedUp).toBeLessThanOrEqual(p.of);
          expect(p.percent === 100).toBe(p.signedUp === p.of);
          expect(p.completedAt !== null).toBe(p.signedUp === p.of);
        },
      ),
    );
  });
});

const team = (name: string, spots: RosterSpot[], expected: number) => ({
  name,
  progress: teamProgress(spots, expected),
});

describe("the challenge leaderboard", () => {
  it("puts the first team to 100% on top, then the rest by percent", () => {
    const ranked = rankTeams(
      [
        team("Half Way", [spot(1, 2), spot(1, null)], 2),
        team("Late Finish", [spot(1, 2), spot(1, 90)], 2),
        team("Early Finish", [spot(1, 2), spot(1, 30)], 2),
        team("Nobody Yet", [spot(1, null)], 4),
      ],
      DEADLINE,
    );
    expect(ranked.map((t) => [t.name, t.rank, t.qualifies])).toEqual([
      ["Early Finish", 1, true],
      ["Late Finish", 2, true],
      ["Half Way", 3, false],
      ["Nobody Yet", 4, false],
    ]);
    expect(challengeLeader(ranked)?.name).toBe("Early Finish");
  });

  it("breaks a tie at 100% by when the last player joined", () => {
    const ranked = rankTeams(
      [
        team("Bees", [spot(1, 2), spot(40, 41)], 2),
        team("Ants", [spot(1, 2), spot(60, 61)], 2),
      ],
      DEADLINE,
    );
    expect(ranked[0]?.name).toBe("Bees");
  });

  it("doesn't count a team that finished after the deadline", () => {
    const ranked = rankTeams(
      [
        team("Too Late", [spot(1, 600)], 1),
        team("Almost", [spot(1, 2), spot(1, null)], 2),
      ],
      DEADLINE,
    );
    expect(ranked.every((t) => !t.qualifies)).toBe(true);
    expect(ranked[0]?.name).toBe("Too Late");
    expect(challengeLeader(ranked)).toBeNull();
  });

  it("leaves a dead heat to the admin", () => {
    const ranked = rankTeams(
      [team("One", [spot(1, 5)], 1), team("Two", [spot(2, 5)], 1)],
      DEADLINE,
    );
    expect(ranked.map((t) => t.rank)).toEqual([1, 1]);
    expect(challengeLeader(ranked)).toBeNull();
  });

  it("orders any set of teams consistently", () => {
    const arbTeam = fc.record({
      name: fc.string({ minLength: 1, maxLength: 6 }),
      spots: fc.array(fc.tuple(fc.nat(700), fc.option(fc.nat(700))), {
        maxLength: 8,
      }),
      expected: fc.integer({ min: 1, max: 8 }),
    });
    fc.assert(
      fc.property(fc.array(arbTeam, { maxLength: 12 }), (raw) => {
        const teams = raw.map((t) =>
          team(
            t.name,
            t.spots.map(([j, s]) => spot(j, s)),
            t.expected,
          ),
        );
        const ranked = rankTeams(teams, DEADLINE);
        expect(ranked).toHaveLength(teams.length);
        // Qualifying teams come first, in order of completion.
        const firstNon = ranked.findIndex((t) => !t.qualifies);
        if (firstNon >= 0)
          expect(ranked.slice(firstNon).every((t) => !t.qualifies)).toBe(true);
        for (let i = 1; i < ranked.length; i++) {
          const a = ranked[i - 1];
          const b = ranked[i];
          if (!a || !b) continue;
          expect(b.rank).toBeGreaterThanOrEqual(a.rank);
          if (a.qualifies && b.qualifies)
            expect(a.progress.completedAt?.getTime()).toBeLessThanOrEqual(
              b.progress.completedAt?.getTime() ?? 0,
            );
          if (!a.qualifies && !b.qualifies)
            expect(a.progress.percent).toBeGreaterThanOrEqual(
              b.progress.percent,
            );
        }
        // Shuffling the input never changes the order.
        expect(
          rankTeams([...teams].reverse(), DEADLINE).map((t) => t.rank),
        ).toEqual(ranked.map((t) => t.rank));
      }),
    );
  });
});

describe("the challenge form", () => {
  it("reads the deadline in the league's time zone and round-trips", () => {
    const form = {
      prize: "A pitcher for the team",
      deadlineOn: "2027-04-01",
      deadlineTime: "23:59",
    };
    const parsed = parseChallengeForm(form, "America/New_York");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.deadline).toEqual(new Date("2027-04-02T03:59:00Z"));
    expect(challengeFormValues(parsed.value, "America/New_York")).toEqual(form);
  });

  it("refuses a missing prize or deadline", () => {
    const tz = "America/New_York";
    const ok = {
      prize: "Shirts",
      deadlineOn: "2027-04-01",
      deadlineTime: "20:00",
    };
    expect(parseChallengeForm({ ...ok, prize: "" }, tz).ok).toBe(false);
    expect(parseChallengeForm({ ...ok, deadlineOn: "2027-02-31" }, tz).ok).toBe(
      false,
    );
    expect(parseChallengeForm({ ...ok, deadlineTime: "25:00" }, tz).ok).toBe(
      false,
    );
  });
});
