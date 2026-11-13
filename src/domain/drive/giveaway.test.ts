import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SeasonId, TeamId } from "@/domain/ids";
import {
  blankGiveawayForm,
  drawWinners,
  type GiveawayForm,
  giveawayFormValues,
  giveawayPhase,
  mayEnter,
  NO_PURCHASE_LINE,
  parseGiveawayForm,
  parseRedrawReason,
  type RandomInt,
} from "./giveaway";

const TZ = "America/New_York";
const OPENS = new Date("2027-03-12T23:00:00Z");
const CLOSES = new Date("2027-03-13T03:00:00Z");
const DURING = new Date("2027-03-13T00:30:00Z");
const times = { opensAt: OPENS, closesAt: CLOSES, drawnAt: null };
const TEAM = "7e000000-0000-4000-8000-000000000001" as TeamId;
const SEASON = "5e000000-0000-4000-8000-000000000001" as SeasonId;

const member = { staff: false, member: true, teams: [] };
const stranger = { staff: false, member: false, teams: [] };
const admin = { staff: true, member: false, teams: [] };

const enter = (over: Partial<Parameters<typeof mayEnter>[0]> = {}) =>
  mayEnter({
    audience: { kind: "public" },
    viewer: member,
    giveaway: times,
    eventCancelled: false,
    alreadyEntered: false,
    now: DURING,
    ...over,
  });

describe("who may enter a giveaway", () => {
  it("lets anyone with an account enter at a public event while it's open", () => {
    expect(enter()).toEqual({ ok: true, value: true });
    expect(enter({ viewer: stranger }).ok).toBe(true);
  });

  it("follows the event's audience for members' and team events", () => {
    expect(enter({ audience: { kind: "members" }, viewer: stranger })).toEqual({
      ok: false,
      error: "not_for_you",
    });
    expect(enter({ audience: { kind: "members" } }).ok).toBe(true);
    const teams = { kind: "teams" as const, seasonId: SEASON, teamIds: [TEAM] };
    expect(enter({ audience: teams }).ok).toBe(false);
    expect(
      enter({
        audience: teams,
        viewer: { ...member, teams: [{ teamId: TEAM, seasonId: SEASON }] },
      }).ok,
    ).toBe(true);
  });

  it("doesn't let an admin into a members' giveaway just for being staff", () => {
    expect(enter({ audience: { kind: "members" }, viewer: admin })).toEqual({
      ok: false,
      error: "not_for_you",
    });
  });

  it("takes one entry per person, only inside the window", () => {
    expect(enter({ alreadyEntered: true })).toEqual({
      ok: false,
      error: "already_entered",
    });
    expect(enter({ now: new Date(OPENS.getTime() - 1) })).toEqual({
      ok: false,
      error: "not_open",
    });
    expect(enter({ now: OPENS }).ok).toBe(true);
    expect(enter({ now: CLOSES })).toEqual({ ok: false, error: "closed" });
    expect(
      enter({ giveaway: { ...times, drawnAt: DURING }, now: DURING }),
    ).toEqual({ ok: false, error: "closed" });
    expect(enter({ eventCancelled: true })).toEqual({
      ok: false,
      error: "event_off",
    });
  });

  it("never depends on anything but the audience, the window and one entry", () => {
    // The function takes no payment, ticket or fee input at all; whatever
    // the time, the answer is open exactly inside the window.
    fc.assert(
      fc.property(fc.integer({ min: -1e10, max: 1e10 }), (offset) => {
        const now = new Date(DURING.getTime() + offset);
        const open = now >= OPENS && now < CLOSES;
        expect(enter({ now }).ok).toBe(open);
      }),
    );
  });

  it("reads its phase from the clock and the draw", () => {
    expect(giveawayPhase(times, new Date(OPENS.getTime() - 1))).toBe(
      "not_open",
    );
    expect(giveawayPhase(times, DURING)).toBe("open");
    expect(giveawayPhase(times, CLOSES)).toBe("closed");
    expect(giveawayPhase({ ...times, drawnAt: CLOSES }, DURING)).toBe("drawn");
  });
});

/** Every sequence of answers a randomInt could give for a draw. */
function allAnswerSequences(n: number, k: number): number[][] {
  let sequences: number[][] = [[]];
  for (let i = 0; i < k; i++) {
    const next: number[][] = [];
    for (const s of sequences)
      for (let r = 0; r < n - i; r++) next.push([...s, r]);
    sequences = next;
  }
  return sequences;
}

const scripted = (answers: readonly number[]): RandomInt => {
  let i = 0;
  return (max) => {
    const a = answers[i++] ?? 0;
    if (a >= max) throw new Error("scripted answer out of range");
    return a;
  };
};

describe("the fair draw", () => {
  it("draws distinct entries, as many as asked or all of them", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { maxLength: 60 }),
        fc.integer({ min: 0, max: 25 }),
        (entries, count) => {
          const { winners, indexes } = drawWinners(entries, count);
          expect(winners).toHaveLength(Math.min(count, entries.length));
          expect(new Set(winners).size).toBe(winners.length);
          for (const w of winners) expect(entries).toContain(w);
          expect(indexes.map((i) => entries[i])).toEqual(winners);
        },
      ),
    );
  });

  it("maps every possible random answer to a different ordered result", () => {
    // Exhaustive: for small draws, each sequence of uniform answers gives a
    // distinct ordered list of winners, and every ordered list appears. So
    // with a uniform source, every outcome is exactly equally likely.
    for (const [n, k] of [
      [1, 1],
      [4, 1],
      [4, 2],
      [5, 3],
      [6, 6],
    ] as const) {
      const entries = Array.from({ length: n }, (_, i) => `entry-${i}`);
      const outcomes = allAnswerSequences(n, k).map((answers) =>
        drawWinners(entries, k, scripted(answers)).winners.join(","),
      );
      let permutations = 1;
      for (let i = 0; i < k; i++) permutations *= n - i;
      expect(new Set(outcomes).size).toBe(permutations);
      expect(outcomes).toHaveLength(permutations);
    }
  });

  it("gives every entry the same chance with the real random source", () => {
    // 6 entries, 2 winners, 30,000 draws: each entry should win a third of
    // the time. A chi-square statistic over 6 cells has 5 degrees of
    // freedom; 30 is far beyond the 0.001 critical value (20.5), so this
    // only fails if the draw is biased.
    const entries = ["a", "b", "c", "d", "e", "f"];
    const wins = new Map(entries.map((e) => [e, 0]));
    const draws = 30_000;
    for (let i = 0; i < draws; i++)
      for (const w of drawWinners(entries, 2).winners)
        wins.set(w, (wins.get(w) ?? 0) + 1);
    const expected = (draws * 2) / entries.length;
    let chi = 0;
    for (const count of wins.values())
      chi += (count - expected) ** 2 / expected;
    expect(chi).toBeLessThan(30);
  });

  it("doesn't depend on who entered first beyond the order it is given", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 3, maxLength: 3 }), (raw) => {
        const entries = ["x", "y", "z", "w"];
        const answers = raw.map((r, i) => r % (entries.length - i));
        const a = drawWinners(entries, 3, scripted(answers));
        const b = drawWinners(entries, 3, scripted(answers));
        expect(a).toEqual(b);
      }),
    );
  });
});

const form = (over: Partial<GiveawayForm> = {}): GiveawayForm => ({
  ...blankGiveawayForm(
    { title: "Spring bar night", startsAt: OPENS, endsAt: CLOSES },
    TZ,
  ),
  prize: "A $50 bar tab",
  ...over,
});

describe("the giveaway form", () => {
  it("starts from the event's times and rules that say no purchase is needed", () => {
    const blank = form();
    expect(blank.opensOn).toBe("2027-03-12");
    expect(blank.opensTime).toBe("18:00");
    expect(blank.closesTime).toBe("22:00");
    expect(blank.officialRules.startsWith(NO_PURCHASE_LINE)).toBe(true);
    const parsed = parseGiveawayForm(blank, TZ);
    expect(parsed.ok && parsed.value.opensAt).toEqual(OPENS);
  });

  it("round-trips a saved giveaway", () => {
    const parsed = parseGiveawayForm(form({ donatedBy: "Kick Bar" }), TZ);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(giveawayFormValues(parsed.value, TZ)).toEqual(
      form({ donatedBy: "Kick Bar" }),
    );
  });

  it("refuses rules that don't say no purchase is necessary", () => {
    expect(
      parseGiveawayForm(
        form({ officialRules: "Buy a ticket to enter the drawing tonight." }),
        TZ,
      ),
    ).toEqual({ ok: false, error: "purchase" });
  });

  it("checks every field", () => {
    expect(parseGiveawayForm(form({ prize: " " }), TZ)).toEqual({
      ok: false,
      error: "prize",
    });
    expect(parseGiveawayForm(form({ winnerCount: "0" }), TZ)).toEqual({
      ok: false,
      error: "winners",
    });
    expect(parseGiveawayForm(form({ winnerCount: "21" }), TZ)).toEqual({
      ok: false,
      error: "winners",
    });
    expect(parseGiveawayForm(form({ closesOn: "2027-02-30" }), TZ)).toEqual({
      ok: false,
      error: "date",
    });
    expect(
      parseGiveawayForm(
        form({ closesOn: "2027-03-12", closesTime: "17:00" }),
        TZ,
      ),
    ).toEqual({ ok: false, error: "order" });
    expect(parseGiveawayForm(form({ officialRules: "short" }), TZ)).toEqual({
      ok: false,
      error: "rules",
    });
    expect(parseGiveawayForm(form({ donatedBy: "x".repeat(81) }), TZ)).toEqual({
      ok: false,
      error: "donor",
    });
  });

  it("needs a real reason for a redraw", () => {
    expect(parseRedrawReason("  no  ")).toEqual({ ok: false, error: "reason" });
    expect(parseRedrawReason(" Didn't claim   in 14 days ")).toEqual({
      ok: true,
      value: "Didn't claim in 14 days",
    });
    expect(parseRedrawReason("x".repeat(301)).ok).toBe(false);
  });
});
