import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import {
  averageOf,
  canFileFor,
  canRate,
  DETAILS_MAX,
  describeLength,
  INCIDENT_KIND_KEYS,
  INCIDENT_KINDS,
  isIncidentKind,
  MAX_GAMES,
  NOTE_MAX,
  OWN_AVERAGE_AFTER,
  ownAverage,
  parseIncidentForm,
  parseLength,
  parseNote,
  parseRating,
  RATING_NOTE_MAX,
  reporterRole,
  seasonIsOver,
  suggestedLength,
  suspendedLabel,
  type SuspensionLength,
  suspensionState,
} from "./discipline";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-10-06T02:00:00Z");

describe("incident kinds", () => {
  it("lists every kind once, with a label", () => {
    expect(INCIDENT_KIND_KEYS).toEqual(Object.keys(INCIDENT_KINDS));
    expect(isIncidentKind("outside_alcohol")).toBe(true);
    expect(isIncidentKind("toString")).toBe(false);
  });
});

describe("who filed", () => {
  it("names a ref first, then a captain, else an admin", () => {
    expect(reporterRole({ refereesGame: true, captainsGame: true })).toBe(
      "referee",
    );
    expect(reporterRole({ refereesGame: false, captainsGame: true })).toBe(
      "captain",
    );
    expect(reporterRole({ refereesGame: false, captainsGame: false })).toBe(
      "admin",
    );
  });
});

describe("filing for a game", () => {
  const kickoff = at("2026-10-06T00:00:00Z");
  it("opens at kickoff and stays open after the score is final", () => {
    expect(
      canFileFor(
        { status: "scheduled", startsAt: kickoff },
        at("2026-10-05T23:59:00Z"),
      ),
    ).toEqual(err("not_started"));
    expect(
      canFileFor({ status: "scheduled", startsAt: kickoff }, kickoff),
    ).toEqual(ok(undefined));
    expect(canFileFor({ status: "final", startsAt: kickoff }, NOW)).toEqual(
      ok(undefined),
    );
    expect(canFileFor({ status: "forfeit", startsAt: null }, NOW)).toEqual(
      ok(undefined),
    );
    expect(canFileFor({ status: "in_progress", startsAt: null }, NOW)).toEqual(
      ok(undefined),
    );
    expect(canFileFor({ status: "scheduled", startsAt: null }, NOW)).toEqual(
      err("not_started"),
    );
  });

  it("is closed for a game that was called off", () => {
    expect(canFileFor({ status: "cancelled", startsAt: kickoff }, NOW)).toEqual(
      err("called_off"),
    );
    expect(canFileFor({ status: "postponed", startsAt: kickoff }, NOW)).toEqual(
      err("called_off"),
    );
  });
});

describe("the incident form", () => {
  const choices = new Set(["a", "b"]);
  it("reads the kind, the trimmed details and the people, once each", () => {
    expect(
      parseIncidentForm(
        { kind: "safety", details: "  Slid into first.  ", people: ["a", "a"] },
        choices,
      ),
    ).toEqual(
      ok({ kind: "safety", details: "Slid into first.", people: ["a"] }),
    );
    expect(
      parseIncidentForm({ kind: "other", details: "x", people: [] }, choices),
    ).toEqual(ok({ kind: "other", details: "x", people: [] }));
  });

  it("refuses an unknown kind, empty or long details, and strangers", () => {
    const base = { kind: "ejection", details: "x", people: [] };
    expect(parseIncidentForm({ ...base, kind: "fight" }, choices)).toEqual(
      err("bad_kind"),
    );
    expect(parseIncidentForm({ ...base, details: "   " }, choices)).toEqual(
      err("no_details"),
    );
    expect(
      parseIncidentForm(
        { ...base, details: "x".repeat(DETAILS_MAX + 1) },
        choices,
      ),
    ).toEqual(err("details_too_long"));
    expect(parseIncidentForm({ ...base, people: ["c"] }, choices)).toEqual(
      err("unknown_person"),
    );
  });

  it("never lets anyone outside the choices through", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 6 }), (people) => {
        const parsed = parseIncidentForm(
          { kind: "other", details: "x", people },
          choices,
        );
        if (parsed.ok)
          expect(parsed.value.people.every((p) => choices.has(p))).toBe(true);
        else expect(parsed.error).toBe("unknown_person");
      }),
    );
  });
});

describe("notes", () => {
  it("trims, and refuses empty or long notes", () => {
    expect(parseNote(" Spoke with both captains. ")).toEqual(
      ok("Spoke with both captains."),
    );
    expect(parseNote("  ")).toEqual(err("no_note"));
    expect(parseNote("x".repeat(NOTE_MAX + 1))).toEqual(err("note_too_long"));
  });
});

describe("ratings", () => {
  it("takes a whole number from 1 to 5 and an optional note", () => {
    expect(parseRating({ score: "4", note: "" })).toEqual(
      ok({ score: 4, note: null }),
    );
    expect(parseRating({ score: "1", note: " Lots of chirping " })).toEqual(
      ok({ score: 1, note: "Lots of chirping" }),
    );
    for (const score of ["0", "6", "3.5", "", "five", "1e0"])
      expect(parseRating({ score, note: "" })).toEqual(err("bad_score"));
    expect(
      parseRating({ score: "3", note: "x".repeat(RATING_NOTE_MAX + 1) }),
    ).toEqual(err("rating_note_too_long"));
  });

  it("opens only once the score is final", () => {
    expect(canRate({ status: "final", startsAt: null })).toBe(true);
    for (const status of ["scheduled", "in_progress", "forfeit", "cancelled"])
      expect(canRate({ status, startsAt: null })).toBe(false);
  });

  it("averages to one decimal", () => {
    expect(averageOf([])).toBeNull();
    expect(averageOf([4, 5, 4])).toBe(4.3);
    expect(averageOf([5])).toBe(5);
  });

  it("keeps any average between 1 and 5", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1 }),
        (scores) => {
          const average = averageOf(scores) ?? 0;
          expect(average).toBeGreaterThanOrEqual(1);
          expect(average).toBeLessThanOrEqual(5);
        },
      ),
    );
  });

  it("moves a captain's average only when a whole block of ratings is in", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), { maxLength: 20 }),
        (scores) => {
          const shown = ownAverage(scores);
          if ("count" in shown) expect(shown.count % OWN_AVERAGE_AFTER).toBe(0);
          // One more rating changes nothing unless it completes a block.
          const next = ownAverage([...scores, 5]);
          if ((scores.length + 1) % OWN_AVERAGE_AFTER !== 0)
            expect(next).toEqual(
              "count" in shown
                ? shown
                : { waitingFor: OWN_AVERAGE_AFTER - scores.length - 1 },
            );
        },
      ),
    );
  });

  it("shows a captain their own average only once no rating can be read from it", () => {
    expect(ownAverage([])).toEqual({ waitingFor: OWN_AVERAGE_AFTER });
    expect(ownAverage([2, 5])).toEqual({ waitingFor: 1 });
    expect(ownAverage([2, 5, 5])).toEqual({ average: 4, count: 3 });
    // The fourth and fifth ratings wait for the sixth.
    expect(ownAverage([2, 5, 5, 1])).toEqual({ average: 4, count: 3 });
    expect(ownAverage([2, 5, 5, 1, 1, 4])).toEqual({ average: 3, count: 6 });
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 5 }), {
          maxLength: OWN_AVERAGE_AFTER - 1,
        }),
        (scores) => {
          expect("average" in ownAverage(scores)).toBe(false);
        },
      ),
    );
  });
});

describe("the outside-alcohol ladder (rulebook 4.0)", () => {
  it("goes one game, then the season, then for good", () => {
    expect(suggestedLength("outside_alcohol", 0)).toEqual({
      scope: "games",
      games: 1,
    });
    expect(suggestedLength("outside_alcohol", 1)).toEqual({ scope: "season" });
    expect(suggestedLength("outside_alcohol", 2)).toEqual({
      scope: "permanent",
    });
    expect(suggestedLength("outside_alcohol", 7)).toEqual({
      scope: "permanent",
    });
  });

  it("suggests nothing for other kinds", () => {
    for (const kind of INCIDENT_KIND_KEYS.filter(
      (k) => k !== "outside_alcohol",
    ))
      expect(suggestedLength(kind, 0)).toBeNull();
  });

  it("never suggests less after more history", () => {
    const rank = (l: SuspensionLength | null) =>
      l === null ? 0 : { games: 1, season: 2, permanent: 3 }[l.scope];
    fc.assert(
      fc.property(fc.nat(10), fc.nat(10), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(
          rank(suggestedLength("outside_alcohol", low)),
        ).toBeLessThanOrEqual(rank(suggestedLength("outside_alcohol", high)));
      }),
    );
  });
});

describe("the suspend form", () => {
  it("reads games, season or permanent", () => {
    expect(parseLength({ scope: "games", games: "2" })).toEqual(
      ok({ scope: "games", games: 2 }),
    );
    expect(parseLength({ scope: "season", games: "" })).toEqual(
      ok({ scope: "season" }),
    );
    expect(parseLength({ scope: "permanent", games: "9" })).toEqual(
      ok({ scope: "permanent" }),
    );
  });

  it("refuses an unknown scope or a game count out of range", () => {
    expect(parseLength({ scope: "week", games: "1" })).toEqual(
      err("bad_scope"),
    );
    for (const games of ["0", "", "-1", "1.5", String(MAX_GAMES + 1)])
      expect(parseLength({ scope: "games", games })).toEqual(err("bad_games"));
  });
});

describe("lengths in words", () => {
  it("reads naturally", () => {
    expect(describeLength({ scope: "games", games: 1 })).toBe("1 game");
    expect(describeLength({ scope: "games", games: 3 })).toBe("3 games");
    expect(describeLength({ scope: "season" })).toBe("the rest of the season");
    expect(describeLength({ scope: "permanent" })).toBe("permanently");
  });

  it("tells a captain the player is out, not why", () => {
    expect(suspendedLabel({ scope: "games", games: 3 }, 1)).toBe(
      "Suspended, 1 more game",
    );
    expect(suspendedLabel({ scope: "games", games: 3 }, 2)).toBe(
      "Suspended, 2 more games",
    );
    expect(suspendedLabel({ scope: "season" }, null)).toBe(
      "Suspended for the season",
    );
    expect(suspendedLabel({ scope: "permanent" }, null)).toBe("Suspended");
  });
});

describe("suspension state", () => {
  const base = { liftedAt: null, gamesServed: 0, seasonOver: false };

  it("counts a games suspension down to served", () => {
    const length = { scope: "games", games: 2 } as const;
    expect(suspensionState({ ...base, length })).toEqual({
      state: "active",
      gamesLeft: 2,
    });
    expect(suspensionState({ ...base, length, gamesServed: 1 })).toEqual({
      state: "active",
      gamesLeft: 1,
    });
    expect(suspensionState({ ...base, length, gamesServed: 2 })).toEqual({
      state: "served",
    });
  });

  it("ends a season suspension with the season, and a permanent one never", () => {
    expect(
      suspensionState({ ...base, length: { scope: "season" }, gamesServed: 9 }),
    ).toEqual({ state: "active", gamesLeft: null });
    expect(
      suspensionState({
        ...base,
        length: { scope: "season" },
        seasonOver: true,
      }),
    ).toEqual({ state: "served" });
    expect(
      suspensionState({
        ...base,
        length: { scope: "permanent" },
        gamesServed: 99,
        seasonOver: true,
      }),
    ).toEqual({ state: "active", gamesLeft: null });
  });

  it("is lifted whatever else is true", () => {
    expect(
      suspensionState({
        ...base,
        length: { scope: "permanent" },
        liftedAt: NOW,
      }),
    ).toEqual({ state: "lifted" });
  });

  it("never has more games left than it started with, nor fewer than one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_GAMES }),
        fc.integer({ min: -3, max: 40 }),
        (games, gamesServed) => {
          const s = suspensionState({
            ...base,
            length: { scope: "games", games },
            gamesServed,
          });
          if (s.state === "active") {
            expect(s.gamesLeft).toBeGreaterThanOrEqual(1);
            expect(s.gamesLeft).toBeLessThanOrEqual(games);
          } else expect(gamesServed).toBeGreaterThanOrEqual(games);
        },
      ),
    );
  });
});

describe("season over", () => {
  it("is over when completed or past its last day", () => {
    expect(
      seasonIsOver(
        { status: "in_progress", endsOn: "2026-10-27" },
        "2026-10-27",
      ),
    ).toBe(false);
    expect(
      seasonIsOver(
        { status: "in_progress", endsOn: "2026-10-27" },
        "2026-10-28",
      ),
    ).toBe(true);
    expect(
      seasonIsOver({ status: "completed", endsOn: "2026-12-01" }, "2026-10-28"),
    ).toBe(true);
  });
});
