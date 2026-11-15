import { describe, expect, it } from "vitest";
import {
  BODY_AREA_KEYS,
  BODY_AREAS,
  CARE_KEYS,
  certificateFor,
  INJURY_RETENTION_YEARS,
  INJURY_TEXT_MAX,
  injuryCutoff,
  injuryExportCsv,
  injuryRemovalDate,
  parseInjuryForm,
  WITNESSES_MAX,
} from "./injury";

const choices = new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
const form = (over: Partial<Parameters<typeof parseInjuryForm>[0]> = {}) => ({
  hurt: "a",
  bodyArea: "knee",
  care: "first_aid",
  details: " Slid into second and twisted it. ",
  witnesses: ["b", "c"],
  ...over,
});

describe("the fixed lists", () => {
  it("name every key once, with words for it", () => {
    expect(BODY_AREA_KEYS).toHaveLength(Object.keys(BODY_AREAS).length);
    expect(CARE_KEYS).toEqual(["none", "first_aid", "ems"]);
  });
});

describe("parseInjuryForm", () => {
  it("reads a complete report and trims the text", () => {
    expect(parseInjuryForm(form(), choices)).toEqual({
      ok: true,
      value: {
        hurt: "a",
        bodyArea: "knee",
        care: "first_aid",
        details: "Slid into second and twisted it.",
        witnesses: ["b", "c"],
      },
    });
  });

  it("needs a person from the game, a listed body area and a care level", () => {
    const error = (over: Parameters<typeof form>[0]) => {
      const r = parseInjuryForm(form(over), choices);
      return r.ok ? null : r.error;
    };
    expect(error({ hurt: "" })).toBe("no_one_hurt");
    expect(error({ hurt: "stranger" })).toBe("unknown_person");
    expect(error({ bodyArea: "elbow-ish" })).toBe("bad_body_area");
    expect(error({ care: "surgery" })).toBe("bad_care");
    expect(error({ details: "   " })).toBe("no_details");
    expect(error({ details: "x".repeat(INJURY_TEXT_MAX + 1) })).toBe(
      "details_too_long",
    );
    expect(
      parseInjuryForm(form({ details: "x".repeat(1000) }), choices).ok,
    ).toBe(true);
  });

  it("counts a witness once, leaves out the person hurt, and checks each", () => {
    const r = parseInjuryForm(form({ witnesses: ["b", "b", "a"] }), choices);
    expect(r.ok && r.value.witnesses).toEqual(["b"]);
    const bad = parseInjuryForm(form({ witnesses: ["b", "nobody"] }), choices);
    expect(bad.ok ? null : bad.error).toBe("unknown_person");
  });

  it("limits the witnesses", () => {
    const many = ["b", "c", "d", "e", "f", "g", "h"];
    expect(many.length).toBeGreaterThan(WITNESSES_MAX);
    const r = parseInjuryForm(form({ witnesses: many }), choices);
    expect(r.ok ? null : r.error).toBe("too_many_witnesses");
    expect(
      parseInjuryForm(form({ witnesses: many.slice(0, 6) }), choices).ok,
    ).toBe(true);
  });
});

describe("retention", () => {
  it("removes the details three years after the report", () => {
    expect(INJURY_RETENTION_YEARS).toBe(3);
    expect(
      injuryRemovalDate(new Date("2026-09-15T23:30:00Z")).toISOString(),
    ).toBe("2029-09-15T23:30:00.000Z");
  });

  it("puts the cutoff three years back from now", () => {
    expect(injuryCutoff(new Date("2029-09-15T23:30:00Z")).toISOString()).toBe(
      "2026-09-15T23:30:00.000Z",
    );
    // A report made exactly at the cutoff is due; one a second later isn't.
    const now = new Date("2029-09-15T23:30:00Z");
    const reportedAt = new Date("2026-09-15T23:30:00Z");
    expect(reportedAt <= injuryCutoff(now)).toBe(true);
    expect(new Date(reportedAt.getTime() + 1000) <= injuryCutoff(now)).toBe(
      false,
    );
  });
});

describe("certificateFor", () => {
  const old = {
    insurer: "Park Mutual",
    policyNumber: "PM-1",
    startsOn: "2025-01-01",
    expiresOn: "2025-12-31",
  };
  const current = {
    insurer: "Park Mutual",
    policyNumber: "PM-2",
    startsOn: "2026-01-01",
    expiresOn: "2026-12-31",
  };

  it("picks the certificate in force on the game's day", () => {
    expect(certificateFor([old, current], "2026-09-15")).toEqual({
      certificate: current,
      covers: true,
    });
    expect(certificateFor([old, current], "2025-06-01")?.certificate).toBe(old);
  });

  it("falls back to the one that ran out last, and says it didn't cover", () => {
    expect(certificateFor([old], "2026-09-15")).toEqual({
      certificate: old,
      covers: false,
    });
    expect(certificateFor([], "2026-09-15")).toBeNull();
  });
});

describe("injuryExportCsv", () => {
  const report = {
    leagueName: "Example Kickball League",
    reportedOn: "2026-09-16",
    gameDay: "2026-09-15",
    matchup: "Aces vs Bees",
    hurt: "Sam Example",
    bodyArea: "knee" as const,
    care: "first_aid" as const,
    details: "Slid into second, twisted the knee.",
    witnesses: ["Jo Example", "Lee Example"],
    followUp: [{ on: "2026-09-18", body: "Called to check in." }],
    insurance: {
      certificate: {
        insurer: "Park Mutual",
        policyNumber: "PM-2",
        startsOn: "2026-01-01",
        expiresOn: "2026-12-31",
      },
      covers: true,
    },
  };

  it("lists the facts and the insurance certificate's dates", () => {
    const csv = injuryExportCsv(report);
    expect(csv).toContain("Field,Value");
    expect(csv).toContain("Person hurt,Sam Example");
    expect(csv).toContain("Body area,Knee");
    expect(csv).toContain("Care given,First aid at the field");
    expect(csv).toContain("Witnesses,Jo Example; Lee Example");
    expect(csv).toContain("Insurance certificate expires,2026-12-31");
    expect(csv).toContain("Insurance certificate valid from,2026-01-01");
    expect(csv).toContain("Certificate in force on the game day,yes");
  });

  it("says so when no certificate is on file or the person's account is gone", () => {
    const csv = injuryExportCsv({ ...report, hurt: null, insurance: null });
    expect(csv).toContain("Insurance certificate,None on file");
    expect(csv).toContain("Person hurt,Removed with their account");
    expect(csv).not.toContain("expires");
  });

  it("defuses a spreadsheet formula in the free text", () => {
    const csv = injuryExportCsv({ ...report, details: "=HYPERLINK(1)" });
    expect(csv).toContain("What happened,'=HYPERLINK(1)");
  });
});
