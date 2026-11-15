import { describe, expect, it } from "vitest";
import {
  change,
  factsFrom,
  type ReportLine,
  reportLines,
  type SeasonFacts,
  show,
} from "./report-card";
import { reportCsvLines } from "./report-csv";
import type { DashboardView } from "./view";

const facts = (over: Partial<SeasonFacts> = {}): SeasonFacts => ({
  name: "Fall 2026",
  members: 100,
  returning: 60,
  newMembers: 40,
  retention: 0.62,
  teams: 8,
  incomeCents: 850_000,
  expenseCents: 400_000,
  netCents: 450_000,
  surveyAverage: 4.2,
  surveyAnswers: 30,
  sportsmanshipAverage: 4.5,
  gamesPlayed: 28,
  rainedOut: 2,
  events: 3,
  eventGoing: 90,
  eventCheckedIn: 40,
  sponsorCheckins: 220,
  ...over,
});

const line = (over: Partial<ReportLine>): ReportLine => ({
  section: "People",
  label: "Players registered",
  kind: "count",
  current: 10,
  previous: 10,
  better: "up",
  ...over,
});

describe("reportLines", () => {
  it("lines up every measure for both seasons", () => {
    const lines = reportLines(
      facts({ name: "Spring 2027", members: 112 }),
      facts(),
    );
    const players = lines.find((l) => l.label === "Players registered");
    expect(players).toMatchObject({ current: 112, previous: 100 });
    expect(new Set(lines.map((l) => l.section))).toEqual(
      new Set(["People", "Money", "Games", "Community"]),
    );
  });

  it("leaves the money out of the shareable version", () => {
    const lines = reportLines(facts(), facts(), { share: true });
    expect(lines.some((l) => l.section === "Money")).toBe(false);
    expect(lines.some((l) => l.kind === "money")).toBe(false);
  });

  it("has nothing before the first season", () => {
    const lines = reportLines(facts(), null);
    expect(lines.every((l) => l.previous === null)).toBe(true);
  });
});

describe("change", () => {
  it("says which way a count moved and whether that is good", () => {
    expect(change(line({ current: 112, previous: 100 }), "Fall 2026")).toEqual({
      direction: "up",
      tone: "good",
      words: "Up 12 from Fall 2026",
      arrow: "▲",
    });
    // Fewer rain-outs is good news.
    expect(
      change(
        line({
          label: "Game times rained out",
          better: "down",
          current: 1,
          previous: 3,
        }),
        "Fall 2026",
      ),
    ).toMatchObject({
      direction: "down",
      tone: "good",
      words: "Down 2 from Fall 2026",
    });
    // Spending more is neither good nor bad on its own.
    expect(
      change(
        line({
          kind: "money",
          better: "neither",
          current: 500_000,
          previous: 400_000,
        }),
        "Fall 2026",
      ),
    ).toMatchObject({ tone: "neutral", words: "Up $1,000.00 from Fall 2026" });
  });

  it("counts rates in points and scores to one decimal", () => {
    expect(
      change(
        line({ kind: "percent", current: 0.68, previous: 0.62 }),
        "Fall 2026",
      ).words,
    ).toBe("Up 6 points from Fall 2026");
    expect(
      change(
        line({ kind: "percent", current: 0.62, previous: 0.61 }),
        "Fall 2026",
      ).words,
    ).toBe("Up 1 point from Fall 2026");
    expect(
      change(line({ kind: "score", current: 4.0, previous: 4.3 }), "Fall 2026"),
    ).toMatchObject({
      words: "Down 0.3 from Fall 2026",
      tone: "bad",
      arrow: "▼",
    });
  });

  it("reads as the same when the shown numbers match", () => {
    expect(
      change(
        line({ kind: "percent", current: 0.621, previous: 0.618 }),
        "Fall 2026",
      ),
    ).toMatchObject({
      direction: "same",
      words: "Same as Fall 2026",
      arrow: "–",
    });
    expect(change(line({}), "Fall 2026").direction).toBe("same");
  });

  it("says when there's nothing to compare", () => {
    expect(change(line({ previous: null }), null).words).toBe(
      "Nothing to compare",
    );
    // A season with no survey has no figure, not a zero.
    expect(
      change(line({ kind: "score", previous: null }), "Fall 2026").words,
    ).toBe("No Fall 2026 figure to compare");
  });
});

describe("show", () => {
  it("formats each kind", () => {
    expect(show("count", 1234)).toBe("1,234");
    expect(show("money", 450_000)).toBe("$4,500.00");
    expect(show("percent", 0.625)).toBe("63%");
    expect(show("score", 4.25)).toBe("4.3 of 5");
    expect(show("score", null)).toBe("–");
  });
});

describe("factsFrom", () => {
  it("adds up a season's dashboard view", () => {
    const view: DashboardView = {
      membership: [
        {
          seasonId: "s1",
          name: "Fall 2026",
          slug: "fall-2026",
          members: 30,
          newMembers: 10,
          returning: 20,
          retained: 18,
          previousMembers: 25,
          retention: 0.72,
          signed: 30,
          paid: 28,
        },
      ],
      money: [
        {
          seasonId: "s1",
          name: "Fall 2026",
          slug: "fall-2026",
          registrationsCents: 0,
          ticketsCents: 0,
          merchCents: 0,
          offAppCents: 100_000,
          refundsCents: 0,
          creditCents: 0,
          incomeCents: 100_000,
          expenses: [],
          expenseTotalCents: 40_000,
          netCents: 60_000,
        },
      ],
      selected: {
        seasonId: "s1",
        membership: null,
        money: null,
        teams: [
          {
            teamSeasonId: "t1",
            name: "Aces",
            members: 15,
            signed: 15,
            paid: 14,
            target: 15,
            waiverRate: 1,
            paymentRate: 0.93,
            signUpRate: 1,
          },
          {
            teamSeasonId: null,
            name: "Not on a team yet",
            members: 2,
            signed: 2,
            paid: 1,
            target: null,
            waiverRate: 1,
            paymentRate: 0.5,
            signUpRate: null,
          },
        ],
        events: [
          {
            id: "e1",
            title: "Bowling",
            startsAt: new Date(),
            signedUp: 20,
            checkedIn: 12,
            turnout: 0.6,
          },
          {
            id: "e2",
            title: "Picnic",
            startsAt: new Date(),
            signedUp: 15,
            checkedIn: null,
            turnout: null,
          },
        ],
        checkins: [
          { weekOf: "2026-09-07", checkins: 5, bySponsor: [] },
          { weekOf: "2026-09-14", checkins: 7, bySponsor: [] },
        ],
      },
    };
    expect(
      factsFrom(
        view,
        { id: "s1", name: "Fall 2026" },
        {
          surveyAverage: null,
          surveyAnswers: 0,
          sportsmanshipAverage: 4.1,
          gamesPlayed: 12,
          rainedOut: 1,
        },
      ),
    ).toEqual({
      name: "Fall 2026",
      members: 30,
      returning: 20,
      newMembers: 10,
      retention: 0.72,
      // Players not on a team yet aren't a team.
      teams: 1,
      incomeCents: 100_000,
      expenseCents: 40_000,
      netCents: 60_000,
      events: 2,
      eventGoing: 35,
      eventCheckedIn: 12,
      sponsorCheckins: 12,
      surveyAverage: null,
      surveyAnswers: 0,
      sportsmanshipAverage: 4.1,
      gamesPlayed: 12,
      rainedOut: 1,
    });
  });
});

describe("reportCsvLines", () => {
  it("writes numbers a spreadsheet can add up, with the change in words", () => {
    const lines = reportCsvLines(
      reportLines(
        facts({ name: "Spring 2027", incomeCents: 900_050 }),
        facts(),
      ),
      "Fall 2026",
    );
    expect(lines.find((l) => l.measure === "Money in")).toEqual({
      section: "Money",
      measure: "Money in",
      unit: "dollars",
      current: 9000.5,
      previous: 8500,
      change: "Up $500.50 from Fall 2026",
    });
    expect(
      lines.find((l) => l.measure === "Back from the season before"),
    ).toMatchObject({
      unit: "percent",
      current: 62,
    });
  });
});
