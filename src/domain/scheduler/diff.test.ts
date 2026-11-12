import { describe, expect, it } from "vitest";
import { diffSchedules } from "./diff";
import { generate } from "./generate";
import { reschedule } from "./reschedule";
import { move, slotId, workedExample } from "./worked-example.fixture";

describe("diffSchedules", () => {
  const [input, schedule] = workedExample();

  it("finds nothing between a schedule and itself", () => {
    expect(diffSchedules(schedule, schedule)).toEqual({
      moved: [],
      added: [],
      removed: [],
      teams: [],
    });
  });

  it("lists moved games and the teams in them", () => {
    const after = move(
      move(schedule, 1, "A-H", slotId(0, 1, 0)),
      3,
      "A-F",
      null,
    );
    expect(diffSchedules(schedule, after)).toEqual({
      moved: [
        { gameKey: "r1:A:H", from: slotId(0, 1, 1), to: slotId(0, 1, 0) },
        { gameKey: "r3:A:F", from: slotId(2, 0, 1), to: null },
      ],
      added: [],
      removed: [],
      teams: ["A", "F", "H"],
    });
  });

  it("lists games only one version has", () => {
    const extra = {
      key: "r8:A:B",
      round: 8,
      teamA: "A",
      teamB: "B",
      slotId: null,
    };
    const after = {
      ...schedule,
      games: [...schedule.games.filter((g) => g.key !== "r7:C:H"), extra],
    };
    const diff = diffSchedules(schedule, after);
    expect(diff.added).toEqual(["r8:A:B"]);
    expect(diff.removed).toEqual(["r7:C:H"]);
    expect(diff.teams).toEqual(["A", "B", "C", "H"]);
  });

  it("shows a rain-out as only the postponed games moving", () => {
    const rained = [0, 1].flatMap((f) => [0, 1, 2].map((t) => slotId(2, f, t)));
    const after = reschedule(input, schedule, rained).schedule;
    const diff = diffSchedules(schedule, after);
    expect(diff.moved.map((m) => m.gameKey)).toEqual([
      "r3:A:F",
      "r3:B:C",
      "r3:D:H",
      "r3:E:G",
    ]);
    expect(diff.teams).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
  });

  it("compares two generated seasons game by game", () => {
    const first = generate({ ...input, seed: 1 });
    const second = generate({ ...input, seed: 1 });
    expect(diffSchedules(first, second).moved).toEqual([]);
  });
});
