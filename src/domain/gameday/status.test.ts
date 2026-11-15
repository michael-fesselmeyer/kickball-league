import { describe, expect, it } from "vitest";
import {
  changesFor,
  type DayGame,
  dayLine,
  type DayStatus,
  gameStatus,
  gameWords,
  parseStatusForm,
  updatedWords,
  watchNews,
} from "./status";

const TZ = "America/New_York";
const DATE = "2026-09-15";
/** EDT wall-clock on Sep 15, 2026. */
const edt = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 15, hour + 4, minute));

const GAMES: DayGame[] = [
  { id: "g1", startsAt: edt(18), teams: "Aces vs Bees" },
  { id: "g2", startsAt: edt(19), teams: "Cats vs Dogs" },
  { id: "g3", startsAt: edt(20), teams: "Elks vs Foxes" },
];

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const parse = (fields: Record<string, string>, now = edt(12)) =>
  parseStatusForm(form(fields), {
    date: DATE,
    timeZone: TZ,
    games: GAMES,
    now,
  });

const status = (
  state: DayStatus["state"],
  games: [string, Date | null][] = [],
  decideBy: Date | null = null,
): Omit<DayStatus, "setAt"> => ({
  state,
  decideBy,
  reason: null,
  games: new Map(games),
});

describe("reading the status form", () => {
  it("reads On, with an optional short reason", () => {
    expect(parse({ state: "on" })).toEqual({
      ok: true,
      value: { ...status("on"), reason: null },
    });
    const withReason = parse({ state: "on", reason: "  Field   dried out " });
    expect(withReason.ok && withReason.value.reason).toBe("Field dried out");
    expect(parse({ state: "on", reason: "x".repeat(121) })).toEqual({
      ok: false,
      error: "reason_too_long",
    });
    expect(parse({ state: "maybe" })).toEqual({
      ok: false,
      error: "bad_state",
    });
  });

  it("needs a decision time ahead and no later than first pitch", () => {
    const watching = parse({ state: "watching", decideBy: "15:00" });
    expect(watching.ok && watching.value.decideBy).toEqual(edt(15));
    expect(parse({ state: "watching" })).toEqual({
      ok: false,
      error: "decide_by_missing",
    });
    expect(parse({ state: "watching", decideBy: "11:00" })).toEqual({
      ok: false,
      error: "decide_by_past",
    });
    expect(parse({ state: "watching", decideBy: "18:30" })).toEqual({
      ok: false,
      error: "decide_by_after_start",
    });
    expect(parse({ state: "watching", decideBy: "18:00" }).ok).toBe(true);
  });

  it("delays chosen games to a later start only", () => {
    const delayed = parse({
      state: "delayed",
      "game:g2": "on",
      "start:g2": "19:45",
    });
    expect(delayed.ok && [...delayed.value.games]).toEqual([
      ["g2", edt(19, 45)],
    ]);
    expect(parse({ state: "delayed" })).toEqual({
      ok: false,
      error: "pick_games",
    });
    expect(parse({ state: "delayed", "game:g2": "on" })).toEqual({
      ok: false,
      error: "start_missing",
    });
    expect(
      parse({ state: "delayed", "game:g2": "on", "start:g2": "19:00" }),
    ).toEqual({ ok: false, error: "start_not_later" });
  });

  it("calls off chosen games, or every game with all", () => {
    const some = parse({ state: "off", "game:g3": "on", reason: "No lights" });
    expect(some.ok && [...some.value.games.keys()]).toEqual(["g3"]);
    const all = parse({ state: "off", all: "on" });
    expect(all.ok && [...all.value.games.keys()]).toEqual(["g1", "g2", "g3"]);
  });

  it("refuses a day whose games have all started", () => {
    expect(parse({ state: "off", all: "on" }, edt(21))).toEqual({
      ok: false,
      error: "day_over",
    });
    // Later games can still change once the first is under way.
    expect(parse({ state: "off", "game:g3": "on" }, edt(18, 30)).ok).toBe(true);
  });

  it("reads times on the day the clocks go back", () => {
    const sunday = parseStatusForm(
      form({ state: "watching", decideBy: "12:00" }),
      {
        date: "2026-11-01",
        timeZone: TZ,
        games: [
          {
            id: "g1",
            startsAt: new Date("2026-11-01T19:00:00Z"),
            teams: "Aces vs Bees",
          },
        ],
        now: new Date("2026-11-01T14:00:00Z"),
      },
    );
    // Noon EST is 17:00 UTC.
    expect(sunday.ok && sunday.value.decideBy).toEqual(
      new Date("2026-11-01T17:00:00Z"),
    );
  });
});

describe("what each game shows", () => {
  it("leaves games the status doesn't touch on", () => {
    const off = status("off", [["g3", null]]);
    expect(gameStatus(off, "g3")).toEqual({ kind: "off" });
    expect(gameStatus(off, "g1")).toEqual({ kind: "on" });
    expect(gameStatus(null, "g1")).toEqual({ kind: "on" });
    expect(gameStatus(status("watching", [], edt(15)), "g2")).toEqual({
      kind: "watching",
      decideBy: edt(15),
    });
    expect(gameWords(gameStatus(off, "g3"), TZ)).toBe("Off");
    expect(
      gameWords(gameStatus(status("delayed", [["g1", edt(18, 45)]]), "g1"), TZ),
    ).toBe("Starts late: 6:45 PM");
  });

  it("writes the day's line, saying whether it's some games or all", () => {
    expect(dayLine(status("on"), 3, TZ)).toBeNull();
    expect(
      dayLine({ ...status("watching", [], edt(15)), reason: "Storms" }, 3, TZ),
    ).toBe("Watching the weather: we'll decide by 3:00 PM. Storms.");
    expect(dayLine(status("off", [["g3", null]]), 3, TZ)).toBe(
      "Some games are off.",
    );
    expect(
      dayLine(
        {
          ...status("off", [
            ["g1", null],
            ["g2", null],
            ["g3", null],
          ]),
          reason: "Field flooded",
        },
        3,
        TZ,
      ),
    ).toBe("All games are off. Field flooded.");
    expect(updatedWords(edt(14, 10), TZ)).toBe("Updated 2:10 PM");
  });
});

describe("who hears about a change", () => {
  const ids = GAMES.map((g) => g.id);

  it("tells the players of newly delayed or off games only", () => {
    expect(
      changesFor(
        status("watching", [], edt(15)),
        status("off", [["g3", null]]),
        ids,
      ),
    ).toEqual([{ gameId: "g3", kind: "off" }]);
    expect(
      changesFor(null, status("delayed", [["g1", edt(18, 30)]]), ids),
    ).toEqual([{ gameId: "g1", kind: "delayed", newStartsAt: edt(18, 30) }]);
  });

  it("tells nobody twice, but does tell a new delay time", () => {
    const delayed = status("delayed", [["g1", edt(18, 30)]]);
    expect(changesFor(delayed, delayed, ids)).toEqual([]);
    expect(
      changesFor(delayed, status("delayed", [["g1", edt(19, 0)]]), ids),
    ).toEqual([{ gameId: "g1", kind: "delayed", newStartsAt: edt(19, 0) }]);
    expect(changesFor(null, status("watching", [], edt(15)), ids)).toEqual([]);
  });

  it("tells a delayed or called-off game's players when it's back on", () => {
    expect(
      changesFor(
        status("off", [
          ["g1", null],
          ["g2", null],
        ]),
        status("off", [["g2", null]]),
        ids,
      ),
    ).toEqual([{ gameId: "g1", kind: "back_on" }]);
    expect(
      changesFor(status("delayed", [["g3", edt(20, 30)]]), status("on"), ids),
    ).toEqual([{ gameId: "g3", kind: "back_on" }]);
  });

  it("sends weather-watch news on a new watch or a new decision time only", () => {
    const watching = status("watching", [], edt(15));
    expect(watchNews(null, watching)).toBe(true);
    expect(watchNews(watching, watching)).toBe(false);
    expect(watchNews(watching, status("watching", [], edt(16)))).toBe(true);
    expect(watchNews(watching, status("on"))).toBe(false);
  });
});

describe("every line a status can make", () => {
  it("says whether some or all games start late, with the reason", () => {
    expect(dayLine(status("delayed", [["g1", edt(18, 30)]]), 3, TZ)).toBe(
      "Some games start late.",
    );
    expect(
      dayLine(
        {
          ...status("delayed", [
            ["g1", edt(18, 30)],
            ["g2", edt(19, 30)],
            ["g3", edt(20, 30)],
          ]),
          reason: "Lights are late",
        },
        3,
        TZ,
      ),
    ).toBe("All games start late. Lights are late.");
  });

  it("writes a line for On only when there is a reason to say", () => {
    expect(dayLine({ ...status("on"), reason: "Field dried out" }, 3, TZ)).toBe(
      "Games are on. Field dried out.",
    );
  });

  it("writes each game's words, and none for a game that is on", () => {
    expect(gameWords({ kind: "on" }, TZ)).toBeNull();
    expect(gameWords({ kind: "watching", decideBy: edt(15) }, TZ)).toBe(
      "Watching the weather: decision by 3:00 PM",
    );
    expect(gameWords({ kind: "off" }, TZ)).toBe("Off");
  });

  it("treats a watch with no time, or a delay with no new start, as on", () => {
    // Neither can be saved (a check and the form rule stop them), but a
    // half-read row must never show a game as late or watched.
    const noTime = status("watching");
    expect(gameStatus(noTime, "g1")).toEqual({ kind: "on" });
    expect(dayLine(noTime, 3, TZ)).toBeNull();
    expect(gameStatus(status("delayed", [["g1", null]]), "g1")).toEqual({
      kind: "on",
    });
  });
});
