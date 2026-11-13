import { describe, expect, it } from "vitest";
import { checkFits, sniffUpload, storageLine, TOTAL_CAP_BYTES } from "./files";
import { buildLedger, money, splitCost } from "./ledger";
import { daysUntil, reminderKey, remindersDue } from "./reminders";
import { buildRequestSheet, gameDates } from "./request-sheet";

describe("buildLedger", () => {
  it("adds money in, money out by category and the net", () => {
    const ledger = buildLedger({
      payments: [
        { method: "stripe", amountCents: 85_000, refundedCents: 0 },
        { method: "stripe", amountCents: 85_000, refundedCents: 10_000 },
        { method: "cash", amountCents: 4_500, refundedCents: 0 },
        { method: "venmo", amountCents: 4_500, refundedCents: 4_500 },
      ],
      creditAppliedCents: 1_500,
      expenses: [
        { category: "equipment", amountCents: 12_999 },
        { category: "equipment", amountCents: 1 },
        { category: "fields_permits", amountCents: 5_000 },
        { category: "shirts", amountCents: 40_000 },
      ],
      permitCostCents: [20_000, 20_000],
    });
    expect(ledger.income).toEqual({
      inAppCents: 170_000,
      offAppCents: 9_000,
      refundsCents: 14_500,
      totalCents: 164_500,
      creditAppliedCents: 1_500,
    });
    const by = Object.fromEntries(
      ledger.expenses.map((e) => [e.category, e.cents]),
    );
    expect(by).toEqual({
      fields_permits: 45_000,
      equipment: 13_000,
      shirts: 40_000,
      refs: 0,
      events: 0,
      sponsor_costs: 0,
      other: 0,
    });
    expect(ledger.permitCostCents).toBe(40_000);
    expect(ledger.expenseTotalCents).toBe(98_000);
    expect(ledger.netCents).toBe(66_500);
  });

  it("is all zeros for an empty season, and can go negative", () => {
    expect(
      buildLedger({
        payments: [],
        creditAppliedCents: 0,
        expenses: [],
        permitCostCents: [],
      }).netCents,
    ).toBe(0);
    expect(
      buildLedger({
        payments: [],
        creditAppliedCents: 0,
        expenses: [{ category: "other", amountCents: 250 }],
        permitCostCents: [],
      }).netCents,
    ).toBe(-250);
  });

  it("writes money with a true minus sign", () => {
    expect(money(123_456)).toBe("$1,234.56");
    expect(money(-4000)).toBe("−$40.00");
    expect(money(0)).toBe("$0.00");
  });

  it("splits a permit's cost so the shares add up exactly", () => {
    expect(splitCost(100_00, 3)).toEqual([3334, 3333, 3333]);
    expect(splitCost(7, 7)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(splitCost(500, 0)).toEqual([]);
    for (const [total, n] of [
      [99_999, 7],
      [1, 4],
      [0, 3],
    ] as const)
      expect(splitCost(total, n).reduce((a, b) => a + b, 0)).toBe(total);
  });
});

describe("buildRequestSheet", () => {
  const base = {
    dates: ["2027-04-17", "2027-04-10"],
    firstGame: "12:00",
    latestEnd: "18:00",
    slotMinutes: 60,
  };

  it("asks for the fewest fields and spreads the games evenly", () => {
    // 12 teams play 6 games a day; 6 hours fit 6 slots on one field.
    const one = buildRequestSheet({
      ...base,
      teams: 12,
      gamesPerTeamPerDay: 1,
    });
    expect(one.ok && one.value.fieldsNeeded).toBe(1);
    // 14 teams play 7 games: two fields, 4 and 3 games, not 6 and 1.
    const sheet = buildRequestSheet({
      ...base,
      teams: 14,
      gamesPerTeamPerDay: 1,
      fieldNames: ["Great Lawn 1"],
    });
    if (!sheet.ok) throw new Error(sheet.error);
    expect(sheet.value.gamesPerDay).toBe(7);
    expect(sheet.value.fieldsNeeded).toBe(2);
    expect(sheet.value.rows).toEqual([
      {
        date: "2027-04-10",
        field: "Great Lawn 1",
        start: "12:00",
        end: "16:00",
        minutes: 240,
        games: 4,
      },
      {
        date: "2027-04-10",
        field: "Field 2",
        start: "12:00",
        end: "15:00",
        minutes: 180,
        games: 3,
      },
      {
        date: "2027-04-17",
        field: "Great Lawn 1",
        start: "12:00",
        end: "16:00",
        minutes: 240,
        games: 4,
      },
      {
        date: "2027-04-17",
        field: "Field 2",
        start: "12:00",
        end: "15:00",
        minutes: 180,
        games: 3,
      },
    ]);
    expect(sheet.value.totalFieldHours).toBe(14);
  });

  it("rounds each field's end up to the half hour", () => {
    const sheet = buildRequestSheet({
      ...base,
      dates: ["2027-04-10"],
      slotMinutes: 50,
      teams: 6,
      gamesPerTeamPerDay: 1,
    });
    // 3 games of 50 minutes end at 14:30 exactly; 4 would end at 15:20 → 15:30.
    expect(sheet.ok && sheet.value.rows[0]?.end).toBe("14:30");
    const four = buildRequestSheet({
      ...base,
      dates: ["2027-04-10"],
      slotMinutes: 50,
      teams: 8,
      gamesPerTeamPerDay: 1,
    });
    expect(four.ok && four.value.rows[0]?.end).toBe("15:30");
  });

  it("gives a team that plays twice two different times", () => {
    // 4 teams, 2 games each: 4 games. Two slots per field would allow 2
    // fields at once, but each team needs two times, so 2 times × 2 fields.
    const sheet = buildRequestSheet({
      ...base,
      latestEnd: "14:00",
      teams: 4,
      gamesPerTeamPerDay: 2,
    });
    if (!sheet.ok) throw new Error(sheet.error);
    expect(sheet.value.fieldsNeeded).toBe(2);
    expect(sheet.value.rows.every((r) => r.games === 2)).toBe(true);
  });

  it("names what is missing", () => {
    expect(
      buildRequestSheet({ ...base, teams: 1, gamesPerTeamPerDay: 1 }),
    ).toEqual({ ok: false, error: "no_teams" });
    expect(
      buildRequestSheet({
        ...base,
        dates: [],
        teams: 8,
        gamesPerTeamPerDay: 1,
      }),
    ).toEqual({ ok: false, error: "no_dates" });
    expect(
      buildRequestSheet({
        ...base,
        latestEnd: "11:00",
        teams: 8,
        gamesPerTeamPerDay: 1,
      }),
    ).toEqual({ ok: false, error: "bad_time" });
    expect(
      buildRequestSheet({
        ...base,
        slotMinutes: 5,
        teams: 8,
        gamesPerTeamPerDay: 1,
      }),
    ).toEqual({ ok: false, error: "bad_length" });
    expect(
      buildRequestSheet({
        ...base,
        latestEnd: "12:30",
        teams: 8,
        gamesPerTeamPerDay: 1,
      }),
    ).toEqual({ ok: false, error: "day_too_short" });
  });

  it("lists the season's game days without blackouts", () => {
    // 2027-04-03 is a Saturday.
    expect(
      gameDates("2027-04-01", "2027-04-30", 6, new Set(["2027-04-17"])),
    ).toEqual(["2027-04-03", "2027-04-10", "2027-04-24"]);
    expect(gameDates("2027-04-05", "2027-04-04", 1)).toEqual([]);
  });
});

describe("remindersDue", () => {
  const deadline = {
    kind: "permit_renews" as const,
    key: "PK-1001",
    on: "2027-03-31",
    subject: "permit PK-1001",
  };

  it("counts whole days across a clock change", () => {
    expect(daysUntil("2027-03-01", "2027-03-31")).toBe(30);
    expect(daysUntil("2027-03-31", "2027-03-30")).toBe(-1);
  });

  it("is due 30 days ahead, then 7, and not before or after", () => {
    const at = (today: string) =>
      remindersDue([deadline], today).map((r) => r.milestone);
    expect(at("2027-02-28")).toEqual([]);
    expect(at("2027-03-01")).toEqual([30]);
    expect(at("2027-03-23")).toEqual([30]);
    expect(at("2027-03-24")).toEqual([7]);
    expect(at("2027-03-31")).toEqual([7]);
    expect(at("2027-04-01")).toEqual([]);
  });

  it("keys each reminder by deadline, milestone and person", () => {
    const [due] = remindersDue([deadline], "2027-03-25");
    if (!due) throw new Error("expected a reminder");
    expect(due.daysLeft).toBe(6);
    expect(reminderKey(due, "u1")).toBe(
      "books-reminder/permit_renews/PK-1001/2027-03-31/7/u1",
    );
  });
});

describe("files", () => {
  it("tells a PDF from a photo by its first bytes", () => {
    expect(sniffUpload(new TextEncoder().encode("%PDF-1.7\n"))).toBe("pdf");
    expect(sniffUpload(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image");
    expect(sniffUpload(new Uint8Array([]))).toBe("image");
  });

  it("refuses a file over 1 MB and one past the total cap", () => {
    expect(checkFits(1024 * 1024, 0)).toBeNull();
    expect(checkFits(1024 * 1024 + 1, 0)).toBe("too_large");
    expect(checkFits(10, TOTAL_CAP_BYTES - 10)).toBeNull();
    expect(checkFits(11, TOTAL_CAP_BYTES - 10)).toBe("storage_full");
  });

  it("says how much is used", () => {
    expect(storageLine(12.4 * 1024 * 1024)).toBe("12.4 MB of 50 MB");
  });
});
