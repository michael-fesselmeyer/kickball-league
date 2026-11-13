import { describe, expect, it } from "vitest";
import { generateSeed, PLAYED_ROUNDS } from "./generate";
import { SEED_HOME_BAR_SLUG, seedSponsorRows } from "./sponsors";

describe("seed sponsors", () => {
  const data = generateSeed();
  const rows = seedSponsorRows(data);

  it("has one home bar, invented and on example addresses", () => {
    expect(rows.sponsors.filter((s) => s.isHomeBar).map((s) => s.slug)).toEqual(
      [SEED_HOME_BAR_SLUG],
    );
    for (const s of rows.sponsors)
      if (s.url) expect(new URL(s.url).hostname).toMatch(/\.example\.test$/);
  });

  it("offers food and soft-drink deals at the home bar, not only drinks", () => {
    const titles = rows.deals
      .filter((d) => d.sponsorId === rows.sponsors[0]?.id)
      .map((d) => d.title.toLowerCase());
    expect(titles.some((t) => t.includes("burger"))).toBe(true);
    expect(titles.some((t) => t.includes("soda"))).toBe(true);
  });

  it("checks players in once a day and uses deals only on those visits", () => {
    const visits = rows.checkins.map((c) => `${c.userId}:${c.onDate}`);
    expect(new Set(visits).size).toBe(visits.length);
    const ids = new Set(rows.checkins.map((c) => c.id));
    expect(rows.redemptions.every((r) => ids.has(r.checkinId))).toBe(true);
    expect(rows.checkins.length).toBeGreaterThan(0);
    expect(rows.redemptions.length).toBeGreaterThan(0);
  });

  it("names a team of the week for each played game day after the first", () => {
    expect(rows.honors).toHaveLength(PLAYED_ROUNDS - 1);
    expect(rows.honors.every((h) => h.reason.length > 0)).toBe(true);
  });

  it("is the same every time apart from the secrets", () => {
    const again = seedSponsorRows(data);
    expect(again.checkins).toEqual(rows.checkins);
    expect(again.honors).toEqual(rows.honors);
    expect(again.sponsors[0]?.checkinSecret).not.toBe(
      rows.sponsors[0]?.checkinSecret,
    );
  });
});
