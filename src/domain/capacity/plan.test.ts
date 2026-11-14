import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildRequestSheet } from "@/domain/books/request-sheet";
import {
  buildPlan,
  busiestPattern,
  defaultGamesPerTeam,
  fits,
  gamesNeeded,
  MAX_TEAMS,
  maxTeams,
  type PlanInput,
  type PlanWindow,
  playable,
  slotsByDate,
  slotsIn,
} from "./plan";

/** Sundays from Sep 6 to Nov 8, 2026: ten game days. */
const SUNDAYS = [
  "2026-09-06",
  "2026-09-13",
  "2026-09-20",
  "2026-09-27",
  "2026-10-04",
  "2026-10-11",
  "2026-10-18",
  "2026-10-25",
  "2026-11-01",
  "2026-11-08",
];

const sundayWindows = (fields: number, start = 12 * 60, end = 18 * 60) =>
  SUNDAYS.flatMap((date) =>
    Array.from({ length: fields }, (_, i) => ({
      date,
      fieldKey: `f${i + 1}`,
      start,
      end,
    })),
  );

const fall = (over: Partial<PlanInput> = {}): PlanInput => ({
  season: { startsOn: "2026-09-06", endsOn: "2026-11-14" },
  windows: sundayWindows(2),
  gameMinutes: 60,
  gamesPerTeam: 10,
  gamesPerTeamPerDay: 1,
  wanted: 30,
  mainField: { id: "field-1", name: "McCarren Park, Field 1" },
  spareField: { id: "field-3", name: "McCarren Park, Field 3" },
  ...over,
});

describe("slots", () => {
  it("cuts back-to-back games from a window, dropping the leftover", () => {
    const w = { date: "2026-09-06", fieldKey: "a", start: 720, end: 1080 };
    expect(slotsIn(w, 60)).toBe(6);
    expect(slotsIn(w, 50)).toBe(7);
    expect(slotsIn(w, 361)).toBe(0);
    expect(slotsIn({ ...w, end: 700 }, 60)).toBe(0);
  });

  it("adds a day's fields together and skips blackouts", () => {
    const windows = sundayWindows(2);
    expect(slotsByDate(windows, 60)).toEqual(Array(10).fill(12));
    expect(slotsByDate(windows, 60, new Set(["2026-09-06"]))).toHaveLength(9);
  });
});

describe("how many teams fit", () => {
  it("fits 24 teams on two fields, six hours each Sunday, ten games each", () => {
    // 12 games a day = 24 teams playing once.
    expect(maxTeams(Array(10).fill(12), 10, 1)).toBe(24);
  });

  it("lets an odd team out sit, so an odd count may fit when the next even one does", () => {
    // Ten days of one game: two teams play every day; three can't all
    // reach ten games because one sits each day.
    expect(fits(Array(10).fill(1), 2, 10, 1)).toBe(true);
    expect(fits(Array(10).fill(1), 3, 10, 1)).toBe(false);
    expect(fits(Array(10).fill(2), 4, 10, 1)).toBe(true);
    expect(fits(Array(10).fill(2), 3, 10, 1)).toBe(false);
  });

  it("caps each day at the games its teams can play", () => {
    // Plenty of slots, but 4 teams play at most 2 games a day.
    expect(playable([10, 10], 4, 1)).toBe(4);
    expect(playable([10, 10], 4, 2)).toBe(8);
  });

  it("fits nobody without field time", () => {
    expect(maxTeams([], 10, 1)).toBe(0);
  });
});

describe("the plan", () => {
  it("shows the gap to the teams that want to play", () => {
    const plan = buildPlan(fall());
    expect(plan.capacity).toMatchObject({
      teams: 24,
      gameDays: 10,
      slots: 120,
      fieldHours: 120,
    });
    expect(plan.gap).toBe(6);
    // 30 teams need 150 games; 2 fields hold 12 a day = 120.
    expect(plan.gamesShort).toBe(30);
  });

  it("offers every kind of option with the teams it adds", () => {
    const plan = buildPlan(fall());
    const by = Object.fromEntries(plan.options.map((o) => [o.kind, o]));
    expect(Object.keys(by).sort()).toEqual([
      "divisions",
      "doubleheaders",
      "extra_weeknight",
      "more_fields",
      "shorter_games",
      "shorter_season",
      "weekend_daytime",
    ]);
    // 45-minute games: 8 a field, 16 a day, 32 teams.
    expect(by.shorter_games).toMatchObject({ gameMinutes: 45, teams: 32 });
    // Doubleheaders don't add slots, so they don't add teams here.
    expect(by.doubleheaders?.extraTeams).toBe(0);
    // A Tuesday 6:30–9:30 on one field: 3 more games a week.
    expect(by.extra_weeknight).toMatchObject({
      weekday: 2,
      first: "18:30",
      last: "21:30",
      needsLights: true,
      teams: 30,
      closesGap: true,
    });
    expect(by.weekend_daytime).toMatchObject({ weekday: 6, teams: 36 });
    expect(by.more_fields).toMatchObject({
      weekday: 0,
      first: "12:00",
      last: "18:00",
      teams: 48,
      fieldName: "McCarren Park, Field 3",
    });
    // A second division of 6 teams on Tuesdays (3 games a night).
    expect(by.divisions).toMatchObject({ teams: 30, closesGap: true });
    // 8 games instead of 10: 120 games for 30 teams.
    expect(by.shorter_season).toMatchObject({ gamesPerTeam: 8, teams: 30 });
  });

  it("asks for exactly the games the season is short", () => {
    const plan = buildPlan(fall());
    const night = plan.options.find((o) => o.kind === "extra_weeknight");
    // 30 games short over 10 Tuesdays: 3 a night, 3 hours each.
    expect(night?.request).toEqual({
      weekday: 2,
      first: "18:30",
      last: "21:30",
      gamesPerDay: 3,
      slotMinutes: 60,
      fieldId: "field-1",
      fieldName: "McCarren Park, Field 1",
      dates: 10,
      fieldHours: 30,
      games: 30,
    });
    // No gap, nothing to ask for.
    const enough = buildPlan(fall({ wanted: 20 }));
    expect(enough.gap).toBe(0);
    expect(enough.options.every((o) => o.request === undefined)).toBe(true);
  });

  it("feeds the request sheet the same games per day", () => {
    const plan = buildPlan(fall());
    const request = plan.options.find(
      (o) => o.kind === "extra_weeknight",
    )?.request;
    expect(request).toBeDefined();
    const sheet = buildRequestSheet({
      teams: 0,
      gamesPerDay: request?.gamesPerDay,
      gamesPerTeamPerDay: 1,
      dates: SUNDAYS,
      firstGame: request?.first ?? "",
      latestEnd: request?.last ?? "",
      slotMinutes: request?.slotMinutes ?? 0,
    });
    expect(sheet.ok && sheet.value.gamesPerDay).toBe(3);
  });

  it("skips options that don't apply", () => {
    const plan = buildPlan(
      fall({ gamesPerTeamPerDay: 2, gamesPerTeam: 2, gameMinutes: 25 }),
    );
    const kinds = plan.options.map((o) => o.kind);
    expect(kinds).not.toContain("doubleheaders");
    expect(kinds).not.toContain("shorter_season");
    expect(kinds).toContain("shorter_games"); // 20 minutes is the floor
  });

  it("leaves out nights the league already plays", () => {
    const weekdays = [1, 2, 3, 4].flatMap((weekday) =>
      SUNDAYS.map((sunday) => {
        const d = new Date(`${sunday}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + weekday);
        return {
          date: d.toISOString().slice(0, 10),
          fieldKey: "f1",
          start: 1110,
          end: 1290,
        };
      }),
    );
    const plan = buildPlan(
      fall({
        windows: [...sundayWindows(1), ...weekdays],
        season: { startsOn: "2026-09-06", endsOn: "2026-11-12" },
      }),
    );
    const kinds = plan.options.map((o) => o.kind);
    expect(kinds).not.toContain("extra_weeknight");
    expect(kinds).not.toContain("divisions");
  });

  it("finds the league's usual weekly window", () => {
    expect(busiestPattern(sundayWindows(1))).toEqual({
      weekday: 0,
      start: 720,
      end: 1080,
    });
    expect(busiestPattern([])).toBeUndefined();
  });

  it("defaults to one game per team per game day", () => {
    expect(defaultGamesPerTeam(sundayWindows(2), 1)).toBe(10);
    expect(defaultGamesPerTeam(sundayWindows(2), 2)).toBe(20);
    expect(defaultGamesPerTeam([], 1)).toBe(1);
  });
});

const arbitraryWindows = fc.array(
  fc.record({
    day: fc.integer({ min: 0, max: 20 }),
    field: fc.integer({ min: 1, max: 3 }),
    start: fc.integer({ min: 8 * 60, max: 20 * 60 }),
    length: fc.integer({ min: 0, max: 8 * 60 }),
  }),
  { maxLength: 40 },
);

const toWindows = (
  raw: { day: number; field: number; start: number; length: number }[],
): PlanWindow[] =>
  raw.map((r) => ({
    date: new Date(Date.UTC(2026, 8, 6 + r.day)).toISOString().slice(0, 10),
    fieldKey: `f${r.field}`,
    start: r.start,
    end: Math.min(24 * 60, r.start + r.length),
  }));

describe("capacity properties", () => {
  it("the most teams fit, and no larger count does", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 15 }),
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom(1, 2),
        (slots, games, perDay) => {
          const n = maxTeams(slots, games, perDay);
          if (n > 0) expect(fits(slots, n, games, perDay)).toBe(true);
          for (let m = Math.max(n + 1, 2); m <= MAX_TEAMS; m += 1)
            expect(fits(slots, m, games, perDay)).toBe(false);
        },
      ),
    );
  });

  it("a fitting season holds every team's games", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 15 }),
        fc.integer({ min: 1, max: 20 }),
        fc.constantFrom(1, 2),
        (slots, games, perDay) => {
          const n = maxTeams(slots, games, perDay);
          fc.pre(n > 0);
          // Enough game days for each team's games, and enough slots.
          expect(
            slots.filter((s) => s > 0).length * perDay,
          ).toBeGreaterThanOrEqual(games);
          expect(slots.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
            gamesNeeded(n, games),
          );
        },
      ),
    );
  });

  it("more field time never fits fewer teams", () => {
    fc.assert(
      fc.property(
        arbitraryWindows,
        arbitraryWindows,
        fc.integer({ min: 30, max: 90 }),
        fc.integer({ min: 1, max: 12 }),
        (base, extra, minutes, games) => {
          const a = maxTeams(slotsByDate(toWindows(base), minutes), games, 1);
          const b = maxTeams(
            slotsByDate(toWindows([...base, ...extra]), minutes),
            games,
            1,
          );
          // Adding time can turn an odd count into an even one at most.
          expect(b).toBeGreaterThanOrEqual(a - (a % 2));
        },
      ),
    );
  });

  it("fewer games per team never fits fewer teams", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 15 }),
        fc.integer({ min: 2, max: 20 }),
        (slots, games) => {
          expect(maxTeams(slots, games - 1, 1)).toBeGreaterThanOrEqual(
            maxTeams(slots, games, 1),
          );
        },
      ),
    );
  });

  it("the gap and every option's extra teams add up", () => {
    fc.assert(
      fc.property(
        arbitraryWindows,
        fc.integer({ min: 30, max: 90 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 80 }),
        (raw, minutes, games, wanted) => {
          const plan = buildPlan({
            season: { startsOn: "2026-09-06", endsOn: "2026-09-26" },
            windows: toWindows(raw),
            gameMinutes: minutes,
            gamesPerTeam: games,
            gamesPerTeamPerDay: 1,
            wanted,
          });
          expect(plan.gap).toBe(Math.max(0, wanted - plan.capacity.teams));
          for (const o of plan.options) {
            expect(o.extraTeams).toBe(
              Math.max(0, o.teams - plan.capacity.teams),
            );
            expect(o.closesGap).toBe(wanted > 0 && o.teams >= wanted);
            if (o.request) {
              expect(plan.gap).toBeGreaterThan(0);
              expect(o.request.games).toBe(
                o.request.gamesPerDay * o.request.dates,
              );
              expect(o.request.gamesPerDay).toBeGreaterThanOrEqual(1);
              expect(o.request.fieldHours).toBeGreaterThan(0);
            }
          }
        },
      ),
    );
  });
});
