import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "../books/ledger";
import {
  checkinWeeks,
  eventTurnout,
  membershipBySeason,
  mondayOf,
  percent,
  rate,
  teamCompletion,
} from "./metrics";
import {
  apportion,
  buildMoneySummary,
  MIN_MEMBERS_TO_PUBLISH,
  publishBlocker,
  seasonFees,
  seasonMoney,
  UNSPENT_LABEL,
} from "./money";

const spring = {
  id: "s1",
  name: "Spring",
  slug: "spring",
  startsOn: "2026-04-01",
};
const summer = {
  id: "s2",
  name: "Summer",
  slug: "summer",
  startsOn: "2026-06-15",
};
const fall = { id: "s3", name: "Fall", slug: "fall", startsOn: "2026-09-10" };

const member = (
  seasonId: string,
  userId: string,
  signed = true,
  paid = true,
) => ({
  seasonId,
  userId,
  signed,
  paid,
});

describe("rate and percent", () => {
  it("divides, and has no rate for an empty whole", () => {
    expect(rate(3, 4)).toBe(0.75);
    expect(rate(0, 0)).toBeNull();
    expect(percent(0.756)).toBe("76%");
    expect(percent(null)).toBe("–");
  });
});

describe("membershipBySeason", () => {
  it("counts new, returning and retained members, oldest season first", () => {
    const rows = [
      member("s1", "ana"),
      member("s1", "ben"),
      member("s1", "cy"),
      member("s1", "dee"),
      // Summer: two back from spring, one new.
      member("s2", "ana"),
      member("s2", "ben", true, false),
      member("s2", "eve", false, false),
      // Fall: dee skipped summer and came back; ana stayed; fay is new.
      member("s3", "ana"),
      member("s3", "dee"),
      member("s3", "fay"),
    ];
    // Given newest first, as the query sorts them.
    const [s1, s2, s3] = membershipBySeason([fall, spring, summer], rows);
    expect(s1).toMatchObject({
      seasonId: "s1",
      members: 4,
      newMembers: 4,
      returning: 0,
      previousMembers: null,
      retention: null,
    });
    expect(s2).toMatchObject({
      members: 3,
      newMembers: 1,
      returning: 2,
      retained: 2,
      previousMembers: 4,
      retention: 0.5,
      signed: 2,
      paid: 1,
    });
    // Dee returns (she played in spring) but wasn't retained from summer.
    expect(s3).toMatchObject({
      members: 3,
      newMembers: 1,
      returning: 2,
      retained: 1,
      previousMembers: 3,
    });
    expect(s3?.retention).toBeCloseTo(1 / 3);
  });

  it("has no retention after an empty season, and ignores unknown seasons", () => {
    const [, s2] = membershipBySeason(
      [spring, summer],
      [member("s2", "ana"), member("gone", "ben")],
    );
    expect(s2).toMatchObject({
      members: 1,
      previousMembers: 0,
      retention: null,
    });
  });

  it("keeps every count consistent for any registrations", () => {
    const seasons = [spring, summer, fall];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            seasonId: fc.constantFrom("s1", "s2", "s3"),
            userId: fc.constantFrom("a", "b", "c", "d", "e", "f"),
            signed: fc.boolean(),
            paid: fc.boolean(),
          }),
        ),
        (rows) => {
          const result = membershipBySeason(seasons, rows);
          const people = new Set(rows.map((r) => r.userId));
          // Everyone is new exactly once, in their first season.
          expect(result.reduce((n, s) => n + s.newMembers, 0)).toBe(
            people.size,
          );
          for (const [i, s] of result.entries()) {
            expect(s.newMembers + s.returning).toBe(s.members);
            expect(s.retained).toBeLessThanOrEqual(s.returning);
            expect(s.previousMembers).toBe(
              i === 0 ? null : result[i - 1]?.members,
            );
            if (s.retention !== null) {
              expect(s.retention).toBeGreaterThanOrEqual(0);
              expect(s.retention).toBeLessThanOrEqual(1);
            }
          }
        },
      ),
    );
  });
});

describe("teamCompletion", () => {
  it("gives each team its rates, with players not on a team last", () => {
    const result = teamCompletion([
      {
        teamSeasonId: null,
        name: "Not on a team yet",
        members: 2,
        signed: 1,
        paid: 0,
        target: null,
      },
      {
        teamSeasonId: "t2",
        name: "Zebras",
        members: 16,
        signed: 16,
        paid: 15,
        target: 14,
      },
      {
        teamSeasonId: "t1",
        name: "Aardvarks",
        members: 10,
        signed: 8,
        paid: 5,
        target: 14,
      },
    ]);
    expect(result.map((t) => t.name)).toEqual([
      "Aardvarks",
      "Zebras",
      "Not on a team yet",
    ]);
    expect(result[0]).toMatchObject({ waiverRate: 0.8, paymentRate: 0.5 });
    expect(result[0]?.signUpRate).toBeCloseTo(10 / 14);
    // Over the target is full, not more than full.
    expect(result[1]?.signUpRate).toBe(1);
    expect(result[2]).toMatchObject({
      waiverRate: 0.5,
      paymentRate: 0,
      signUpRate: null,
    });
  });
});

describe("eventTurnout", () => {
  it("compares check-ins with sign-ups for ticketed events only", () => {
    const at = new Date("2026-07-01T23:00:00Z");
    const [ticketed, free, empty] = eventTurnout([
      { id: "e1", title: "Bowling", startsAt: at, signedUp: 20, checkedIn: 15 },
      {
        id: "e2",
        title: "Picnic",
        startsAt: at,
        signedUp: 40,
        checkedIn: null,
      },
      { id: "e3", title: "Trivia", startsAt: at, signedUp: 0, checkedIn: 0 },
    ]);
    expect(ticketed?.turnout).toBe(0.75);
    expect(free?.turnout).toBeNull();
    expect(empty?.turnout).toBeNull();
  });
});

describe("checkinWeeks", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-06-15")).toBe("2026-06-15"); // a Monday
    expect(mondayOf("2026-06-21")).toBe("2026-06-15"); // the Sunday after
    expect(mondayOf("2026-06-14")).toBe("2026-06-08");
  });

  it("lists every week of the season, empty weeks as zero", () => {
    const weeks = checkinWeeks(
      [
        { weekOf: "2026-06-22", sponsor: "The Corner Pocket", checkins: 3 },
        { weekOf: "2026-06-22", sponsor: "Dugout Tavern", checkins: 5 },
        { weekOf: "2026-06-08", sponsor: "Dugout Tavern", checkins: 1 },
      ],
      "2026-06-10",
      "2026-06-28",
    );
    expect(weeks.map((w) => [w.weekOf, w.checkins])).toEqual([
      ["2026-06-08", 1],
      ["2026-06-15", 0],
      ["2026-06-22", 8],
    ]);
    expect(weeks[2]?.bySponsor.map((s) => s.sponsor)).toEqual([
      "Dugout Tavern",
      "The Corner Pocket",
    ]);
  });
});

describe("seasonMoney", () => {
  it("splits money in by kind and agrees with the books' ledger", () => {
    const money = seasonMoney({
      seasonId: "s1",
      payments: [
        {
          seasonId: "s1",
          method: "stripe",
          ticket: false,
          amountCents: 100_000,
          refundedCents: 5_000,
        },
        {
          seasonId: "s1",
          method: "stripe",
          ticket: true,
          amountCents: 30_000,
          refundedCents: 0,
        },
        {
          seasonId: "s1",
          method: "cash",
          ticket: false,
          amountCents: 12_000,
          refundedCents: 2_000,
        },
        {
          seasonId: "s1",
          method: "venmo",
          ticket: false,
          amountCents: 8_000,
          refundedCents: 0,
        },
      ],
      creditCents: 1_500,
      expenses: [
        { seasonId: "s1", category: "refs", amountCents: 40_000 },
        { seasonId: "s1", category: "fields_permits", amountCents: 10_000 },
      ],
      permitCostCents: 25_000,
    });
    expect(money).toMatchObject({
      registrationsCents: 100_000,
      ticketsCents: 30_000,
      offAppCents: 20_000,
      refundsCents: 7_000,
      creditCents: 1_500,
      incomeCents: 143_000,
      expenseTotalCents: 75_000,
      netCents: 68_000,
    });
    expect(
      money.expenses.find((e) => e.category === "fields_permits")?.cents,
    ).toBe(35_000);
  });
});

describe("apportion", () => {
  it("splits cents so the parts add up exactly", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(apportion(500, [0, 0])).toEqual([0, 0]);
  });

  it("always adds up to the total and never goes below zero", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), {
          minLength: 1,
          maxLength: 9,
        }),
        (total, weights) => {
          const parts = apportion(total, weights);
          if (weights.every((w) => w === 0)) return;
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          for (const p of parts) expect(p).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("buildMoneySummary", () => {
  const expenses = (cents: Partial<Record<ExpenseCategory, number>>) =>
    seasonMoney({
      seasonId: "s1",
      payments: [],
      creditCents: 0,
      expenses: EXPENSE_CATEGORIES.flatMap((category) => {
        const amountCents = cents[category];
        return amountCents ? [{ seasonId: "s1", category, amountCents }] : [];
      }),
      permitCostCents: 0,
    }).expenses;

  it("shows category totals, largest first, with what is not spent yet", () => {
    const summary = buildMoneySummary(
      {
        incomeCents: 200_000,
        expenses: expenses({
          fields_permits: 80_000,
          refs: 60_000,
          shirts: 20_000,
        }),
      },
      [{ label: "Player fee", cents: 9_000 }],
      [],
    );
    expect(summary.collectedCents).toBe(200_000);
    expect(summary.spentCents).toBe(160_000);
    expect(summary.unspentCents).toBe(40_000);
    expect(summary.categories).toEqual([
      { label: "Fields and permits", cents: 80_000, share: 0.4 },
      { label: "Refs", cents: 60_000, share: 0.3 },
      { label: "Shirts", cents: 20_000, share: 0.1 },
    ]);
    expect(summary.fees[0]?.parts).toEqual([
      { label: "Fields and permits", cents: 3_600 },
      { label: "Refs", cents: 2_700 },
      { label: "Shirts", cents: 900 },
      { label: UNSPENT_LABEL, cents: 1_800 },
    ]);
  });

  it("folds chosen categories into Other", () => {
    const summary = buildMoneySummary(
      {
        incomeCents: 100_000,
        expenses: expenses({ refs: 30_000, other: 5_000, shirts: 10_000 }),
      },
      [],
      ["refs"],
    );
    expect(summary.categories.map((c) => [c.label, c.cents])).toEqual([
      ["Other", 35_000],
      ["Shirts", 10_000],
    ]);
  });

  it("takes shares of spending when it ran over the money collected", () => {
    const summary = buildMoneySummary(
      {
        incomeCents: 50_000,
        expenses: expenses({ refs: 60_000, shirts: 40_000 }),
      },
      [{ label: "Team fee", cents: 100_000 }],
      [],
    );
    expect(summary.unspentCents).toBe(0);
    expect(summary.categories.map((c) => c.share)).toEqual([0.6, 0.4]);
    expect(summary.fees[0]?.parts).toEqual([
      { label: "Refs", cents: 60_000 },
      { label: "Shirts", cents: 40_000 },
    ]);
  });

  it("names no person and carries only totals", () => {
    const summary = buildMoneySummary(
      { incomeCents: 10_000, expenses: expenses({ refs: 2_500 }) },
      [{ label: "Player fee", cents: 0 }],
      [],
    );
    expect(Object.keys(summary).sort()).toEqual(
      [
        "categories",
        "collectedCents",
        "fees",
        "spentCents",
        "unspentCents",
      ].sort(),
    );
    // A free fee has nothing to divide.
    expect(summary.fees).toEqual([]);
  });
});

describe("seasonFees", () => {
  it("lists the fees the season charges", () => {
    expect(
      seasonFees({
        feeModel: "per_team",
        teamFeeCents: 90_000,
        playerFeeCents: 6_000,
        freeAgentFeeCents: 7_000,
      }),
    ).toEqual([
      { label: "Team fee", cents: 90_000 },
      { label: "Free agent fee", cents: 7_000 },
    ]);
    expect(
      seasonFees({
        feeModel: "per_player",
        teamFeeCents: null,
        playerFeeCents: 6_000,
        freeAgentFeeCents: null,
      }),
    ).toEqual([{ label: "Player fee", cents: 6_000 }]);
  });
});

describe("publishBlocker", () => {
  const summary = buildMoneySummary(
    { incomeCents: 10_000, expenses: [] },
    [],
    [],
  );
  it("needs enough members that no total stands for one person", () => {
    expect(
      publishBlocker({ members: MIN_MEMBERS_TO_PUBLISH - 1, summary }),
    ).toBe("too_few_members");
    expect(
      publishBlocker({ members: MIN_MEMBERS_TO_PUBLISH, summary }),
    ).toBeNull();
  });
  it("needs some money in or out", () => {
    const empty = buildMoneySummary({ incomeCents: 0, expenses: [] }, [], []);
    expect(publishBlocker({ members: 50, summary: empty })).toBe("no_money");
  });
});
