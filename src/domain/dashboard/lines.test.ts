import { describe, expect, it } from "vitest";
import { toCsv } from "../export/csv";
import { DASHBOARD_COLUMNS, dashboardLines } from "./csv";
import { reportColumns, reportCsvLines } from "./report-csv";
import type { ReportLine } from "./report-card";
import type { DashboardView } from "./view";

const view: DashboardView = {
  membership: [
    {
      seasonId: "s1",
      name: "Spring",
      slug: "spring",
      members: 80,
      newMembers: 30,
      returning: 50,
      retained: 40,
      previousMembers: 90,
      retention: 0.4567,
      signed: 70,
      paid: 60,
    },
    {
      seasonId: "s0",
      name: "Summer",
      slug: "summer",
      members: 0,
      newMembers: 0,
      returning: 0,
      retained: 0,
      previousMembers: null,
      retention: null,
      signed: 0,
      paid: 0,
    },
  ],
  money: [
    {
      seasonId: "s1",
      name: "Spring",
      slug: "spring",
      registrationsCents: 800_050,
      ticketsCents: 1_000,
      merchCents: 0,
      offAppCents: 2_500,
      refundsCents: 5_000,
      incomeCents: 798_550,
      creditCents: 1_234,
      expenses: [{ category: "refs", label: "Refs", cents: 12_345 }],
      expenseTotalCents: 12_345,
      netCents: 786_205,
    },
  ],
  selected: {
    seasonId: "s1",
    membership: null,
    money: null,
    teams: [
      {
        teamSeasonId: "t1",
        name: "Sharks",
        members: 10,
        target: 12,
        signUpRate: 0.8333,
        signed: 9,
        waiverRate: 0.9,
        paid: 8,
        paymentRate: null,
      },
    ],
    events: [],
    checkins: [
      {
        weekOf: "2027-03-01",
        checkins: 5,
        bySponsor: [
          { sponsor: "Pizza Place", checkins: 3 },
          { sponsor: "Bar", checkins: 2 },
        ],
      },
    ],
  },
};

describe("dashboardLines", () => {
  const lines = dashboardLines(view, "Spring 2027", "America/New_York");
  const find = (section: string, item: string, measure: string) =>
    lines.find(
      (l) => l.section === section && l.item === item && l.measure === measure,
    );

  it("writes money in dollars and refunds as a negative", () => {
    expect(
      find("Money", "Money in", "Registrations in the app ($)")?.value,
    ).toBe(8000.5);
    expect(find("Money", "Money in", "Refunds ($)")?.value).toBe(-50);
    expect(find("Money", "Money out", "Refs ($)")?.value).toBe(123.45);
    expect(find("Money", "Net", "Money in less money out ($)")?.value).toBe(
      7862.05,
    );
  });

  it("writes rates as percentages with one decimal, and a missing rate as empty", () => {
    expect(find("Membership", "", "Retention %")?.value).toBe(45.7);
    expect(find("Membership", "", "Retention %")?.season).toBe("Spring");
    expect(find("Teams", "Sharks", "Sign-up %")?.value).toBe(83.3);
    expect(find("Teams", "Sharks", "Payment %")?.value).toBeNull();
    const csv = toCsv(DASHBOARD_COLUMNS, lines);
    expect(csv).toContain("Teams,Spring 2027,Sharks,Payment %,\r\n");
  });

  it("lists each week's sponsor check-ins under the selected season", () => {
    expect(
      find("Sponsor check-ins", "Week of 2027-03-01", "All sponsors")?.value,
    ).toBe(5);
    expect(
      find("Sponsor check-ins", "Week of 2027-03-01", "Pizza Place")?.value,
    ).toBe(3);
  });

  it("writes one line per measure and carries no names but teams, sponsors and events", () => {
    expect(lines.filter((l) => l.section === "Membership")).toHaveLength(14);
    expect(lines.filter((l) => l.section === "Teams")).toHaveLength(7);
  });
});

describe("report CSV", () => {
  const line = (over: Partial<ReportLine>): ReportLine => ({
    section: "Money",
    label: "Income",
    kind: "money",
    current: 123_456,
    previous: 100_000,
    better: "up",
    ...over,
  });

  it("converts each kind to the unit a spreadsheet can add", () => {
    const rows = reportCsvLines(
      [
        line({}),
        line({
          label: "Fill",
          kind: "percent",
          current: 0.8765,
          previous: 0.5,
        }),
        line({ label: "Fun", kind: "score", current: 4.26, previous: 4.0 }),
        line({ label: "Players", kind: "count", current: 80, previous: 70 }),
      ],
      "Winter",
    );
    expect(rows.map((r) => [r.unit, r.current, r.previous])).toEqual([
      ["dollars", 1234.56, 1000],
      ["percent", 87.7, 50],
      ["out of 5", 4.3, 4],
      ["count", 80, 70],
    ]);
    expect(rows[0]?.change).toBe("Up $234.56 from Winter");
  });

  it("keeps a missing figure empty rather than zero", () => {
    const [row] = reportCsvLines([line({ previous: null })], null);
    expect(row?.previous).toBeNull();
    expect(row?.change).toBe("Nothing to compare");
  });

  it("titles the season columns, with a fallback when there is no earlier season", () => {
    const csv = toCsv(
      reportColumns("Spring", null),
      reportCsvLines([line({})], null),
    );
    expect(csv.split("\r\n")[0]).toBe(
      "﻿Section,Measure,Unit,Spring,Season before,Change",
    );
    expect(reportColumns("Spring", "Winter")[4]?.header).toBe("Winter");
  });
});
