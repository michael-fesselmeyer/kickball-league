import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { placeBracket, seedOrder, type BracketMatch } from "./bracket";
import type { Slot } from "./types";
import { slot } from "./worked-example.fixture";

/** Playoff slots: `fields` fields × `times` time indexes on each date. */
const playoffDay = (date: string, fields: number, times: number): Slot[] =>
  Array.from({ length: fields * times }, (_, k) => ({
    ...slot(
      `${date}/F${(k % fields) + 1}/${Math.floor(k / fields)}`,
      date,
      `F${(k % fields) + 1}`,
      Math.floor(k / fields),
    ),
    kind: "playoff" as const,
  }));

const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
const label = (m: BracketMatch) =>
  [m.home, m.away]
    .map((s) => ("seed" in s ? String(s.seed) : `W(${s.winnerOf})`))
    .join("v");

describe("seedOrder", () => {
  it("keeps the top seeds apart until the final", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });
});

describe("placeBracket", () => {
  it("places 8 teams on 2 fields in 4 time slots, as the spec describes", () => {
    const day = "2027-08-08";
    const { matches, diagnostics } = placeBracket(
      teams(8),
      playoffDay(day, 2, 4),
    );
    expect(diagnostics).toEqual([]);
    expect(matches.map(label)).toEqual([
      "1v8",
      "4v5",
      "2v7",
      "3v6",
      "W(r1m1)vW(r1m2)",
      "W(r1m3)vW(r1m4)",
      "W(r2m1)vW(r2m2)",
    ]);
    // Quarterfinals fill time slots 0 and 1, semifinals 2, the final 3.
    expect(matches.map((m) => m.slotId?.split("/").slice(1).join("/"))).toEqual(
      ["F1/0", "F2/0", "F1/1", "F2/1", "F1/2", "F2/2", "F1/3"],
    );
  });

  it("gives the top seeds byes when the field is not a power of two", () => {
    const { matches } = placeBracket(teams(6), playoffDay("2027-08-08", 2, 4));
    // Ids follow bracket positions, so seeds 1 and 2 (byes) leave gaps.
    expect(matches.map((m) => `${m.id}:${label(m)}`)).toEqual([
      "r1m2:4v5",
      "r1m4:3v6",
      "r2m1:1vW(r1m2)",
      "r2m2:2vW(r1m4)",
      "r3m1:W(r2m1)vW(r2m2)",
    ]);
  });

  it("continues on the next playoff date when a day runs out, and says so", () => {
    const slots = [
      ...playoffDay("2027-08-08", 2, 3),
      ...playoffDay("2027-08-15", 2, 3),
    ];
    const { matches, diagnostics } = placeBracket(teams(8), slots);
    const final = matches.find((m) => m.id === "r3m1");
    expect(final?.slotId).toBe("2027-08-15/F1/0");
    expect(diagnostics).toEqual([
      "Round 3 continues on 2027-08-15: 2027-08-08 has no more room.",
    ]);
  });

  it("notes a first round split over two dates", () => {
    const slots = [
      ...playoffDay("2027-08-08", 1, 2),
      ...playoffDay("2027-08-15", 2, 4),
    ];
    const { diagnostics } = placeBracket(teams(8), slots);
    expect(diagnostics[0]).toBe(
      "Round 1 continues on 2027-08-15: 2027-08-08 has no more room.",
    );
  });

  it("reports matches with no slot", () => {
    const { matches, diagnostics } = placeBracket(
      teams(4),
      playoffDay("2027-08-08", 1, 2),
    );
    expect(matches.filter((m) => m.slotId === null).map((m) => m.id)).toEqual([
      "r2m1",
    ]);
    expect(diagnostics).toEqual([
      "Not enough playoff slots: match r2m1 has no slot.",
    ]);
  });

  it("has nothing to place for fewer than two teams", () => {
    expect(placeBracket(["T1"], playoffDay("2027-08-08", 2, 2))).toEqual({
      matches: [],
      diagnostics: [],
    });
  });
});

describe("placeBracket properties", () => {
  it("plays n − 1 matches, every team once in round one or with a bye, each after its feeders", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 24 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 2, max: 6 }),
        (n, fields, times) => {
          const slots = [
            "2027-08-08",
            "2027-08-15",
            "2027-08-22",
            "2027-08-29",
            "2027-09-05",
          ].flatMap((d) => playoffDay(d, fields, times));
          const { matches } = placeBracket(teams(n), slots);
          expect(matches).toHaveLength(n - 1);
          const seeded = matches.flatMap((m) =>
            [m.home, m.away].flatMap((s) => ("seed" in s ? [s.teamId] : [])),
          );
          expect(new Set(seeded)).toEqual(new Set(teams(n)));
          expect(seeded).toHaveLength(n);
          const placed = matches.flatMap((m) => m.slotId ?? []);
          expect(new Set(placed).size).toBe(placed.length);
          const order = (id: string | null) => {
            const s = slots.find((x) => x.id === id);
            return s ? `${s.date}#${String(s.timeIndex).padStart(2, "0")}` : "";
          };
          for (const m of matches)
            for (const side of [m.home, m.away])
              if ("winnerOf" in side && m.slotId !== null) {
                const feeder = matches.find((x) => x.id === side.winnerOf);
                if (feeder?.slotId)
                  expect(order(feeder.slotId) < order(m.slotId)).toBe(true);
              }
        },
      ),
      { numRuns: 300 },
    );
  });
});
