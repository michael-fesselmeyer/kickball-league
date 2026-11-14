import { describe, expect, it } from "vitest";
import {
  type CommandRow,
  commandState,
  REF_LATE_MS,
  refState,
  scoreState,
} from "./command-center";

const KICKOFF = new Date("2026-11-14T18:00:00Z");
const END = new Date("2026-11-14T19:00:00Z");
const minutes = (n: number) => new Date(KICKOFF.getTime() + n * 60_000);

const row = (over: Partial<CommandRow> = {}): CommandRow => ({
  id: "g1",
  status: "scheduled",
  slotCancelled: false,
  startsAt: KICKOFF,
  endsAt: END,
  fieldName: "Field 1",
  teamA: { id: "a", name: "Sun Kickers" },
  teamB: { id: "b", name: "Foul Play" },
  kicksFirst: null,
  scoreA: null,
  scoreB: null,
  referee: { name: "Jamie Example", checkedInAt: null },
  report: null,
  halves: [],
  ...over,
});

describe("scoreState", () => {
  it("follows a game from not started to missing", () => {
    expect(scoreState(row(), minutes(-30))).toBe("upcoming");
    expect(scoreState(row(), minutes(10))).toBe("on");
    expect(scoreState(row(), minutes(61))).toBe("missing");
  });

  it("is live once a half is entered or the game is under way", () => {
    expect(
      scoreState(
        row({ halves: [{ inning: 1, half: "top", runs: 2 }] }),
        minutes(70),
      ),
    ).toBe("live");
    expect(scoreState(row({ status: "in_progress" }), minutes(5))).toBe("live");
  });

  it("puts a reported score, a final and a called-off game ahead of the clock", () => {
    expect(
      scoreState(row({ report: { scoreA: 5, scoreB: 3 } }), minutes(90)),
    ).toBe("reported");
    expect(
      scoreState(
        row({
          status: "final",
          scoreA: 5,
          scoreB: 3,
          report: { scoreA: 5, scoreB: 3 },
        }),
        minutes(90),
      ),
    ).toBe("final");
    expect(scoreState(row({ status: "forfeit" }), minutes(-5))).toBe("final");
    expect(scoreState(row({ slotCancelled: true }), minutes(90))).toBe(
      "called_off",
    );
    expect(scoreState(row({ status: "postponed" }), minutes(90))).toBe(
      "called_off",
    );
  });
});

describe("refState", () => {
  it("flags a ref who isn't checked in close to kickoff", () => {
    const early = new Date(KICKOFF.getTime() - REF_LATE_MS - 1);
    const close = new Date(KICKOFF.getTime() - REF_LATE_MS);
    expect(refState(row(), early)).toBe("waiting");
    expect(refState(row(), close)).toBe("late");
    expect(
      refState(
        row({ referee: { name: "Jamie Example", checkedInAt: minutes(-40) } }),
        close,
      ),
    ).toBe("checked_in");
    expect(refState(row({ referee: null }), close)).toBe("none");
  });
});

describe("commandState", () => {
  it("orders games by kickoff and field, with runs and counts", () => {
    const state = commandState(
      [
        row({
          id: "late",
          fieldName: "Field 1",
          startsAt: minutes(60),
          endsAt: minutes(120),
        }),
        row({
          id: "live",
          fieldName: "Field 2",
          kicksFirst: "B",
          halves: [
            { inning: 1, half: "top", runs: 3 },
            { inning: 1, half: "bottom", runs: 1 },
            { inning: 2, half: "top", runs: 2 },
          ],
          referee: { name: "Jamie Example", checkedInAt: minutes(-20) },
        }),
        row({
          id: "final",
          fieldName: "Field 1",
          status: "final",
          scoreA: 7,
          scoreB: 4,
          referee: null,
        }),
        row({ id: "off", fieldName: "Field 3", slotCancelled: true }),
      ],
      "2026-11-14",
      minutes(30),
    );
    expect(state.games.map((g) => g.id)).toEqual([
      "final",
      "live",
      "off",
      "late",
    ]);
    const live = state.games[1];
    // B kicks in the top: B has 3 + 2, A has 1.
    expect(live?.runs).toEqual({ a: 1, b: 5 });
    expect(live?.inning).toBe("Top 2nd");
    expect(state.games[0]?.runs).toEqual({ a: 7, b: 4 });
    expect(state.games[0]?.referee.state).toBe("none");
    expect(state.counts).toEqual({
      games: 4,
      // The called-off game's field isn't in use.
      fields: 2,
      refsIn: 1,
      refsAssigned: 2,
      live: 1,
      missing: 0,
    });
    // Plain data: it survives JSON unchanged.
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("counts a missing score after the slot is over", () => {
    const state = commandState([row()], "2026-11-14", minutes(75));
    expect(state.counts.missing).toBe(1);
    expect(state.games[0]?.score).toBe("missing");
  });

  it("names the 11th to 13th innings with th", () => {
    const state = commandState(
      [row({ halves: [{ inning: 11, half: "bottom", runs: 0 }] })],
      "2026-11-14",
      minutes(200),
    );
    expect(state.games[0]?.inning).toBe("Bottom 11th");
  });
});
