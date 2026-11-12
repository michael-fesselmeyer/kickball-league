import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatCents,
  type PricedSeason,
  priceFor,
  registrationWindow,
  splitShare,
} from "./pricing";

const perPlayer: PricedSeason = {
  status: "registration_open",
  feeModel: "per_player",
  teamFeeCents: null,
  playerFeeCents: 8500,
  freeAgentFeeCents: null,
  earlyBirdEndsAt: new Date("2027-03-01T04:59:59Z"),
  earlyBirdDiscountCents: 1000,
  registrationOpensAt: new Date("2027-02-01T05:00:00Z"),
  registrationClosesAt: new Date("2027-03-23T03:59:59Z"),
};
const perTeam: PricedSeason = {
  ...perPlayer,
  feeModel: "per_team",
  teamFeeCents: 120_000,
  playerFeeCents: null,
  freeAgentFeeCents: 9000,
};
const early = new Date("2027-02-15T12:00:00Z");
const late = new Date("2027-03-10T12:00:00Z");
const captain = (paymentMode: "full" | "split", rosterSize = 14) => ({
  kind: "captain" as const,
  paymentMode,
  rosterSize,
});

describe("registrationWindow", () => {
  it("is open only with the status and inside the dates", () => {
    expect(registrationWindow(perPlayer, early)).toBe("open");
    expect(registrationWindow(perPlayer, new Date("2027-01-01"))).toBe(
      "not_open",
    );
    expect(registrationWindow(perPlayer, new Date("2027-04-01"))).toBe(
      "closed",
    );
    expect(registrationWindow({ ...perPlayer, status: "draft" }, early)).toBe(
      "not_open",
    );
    expect(
      registrationWindow({ ...perPlayer, status: "in_progress" }, early),
    ).toBe("closed");
    expect(
      registrationWindow(
        { ...perPlayer, registrationOpensAt: null, registrationClosesAt: null },
        early,
      ),
    ).toBe("open");
  });
});

describe("priceFor", () => {
  it("charges each player the player fee, less the early bird", () => {
    expect(
      priceFor(perPlayer, { kind: "teammate", shareCents: null }, early),
    ).toEqual({ ok: true, cents: 7500, shareCents: null, earlyBird: true });
    expect(priceFor(perPlayer, captain("full"), late)).toEqual({
      ok: true,
      cents: 8500,
      shareCents: null,
      earlyBird: false,
    });
    // Free agents pay the player fee when no free-agent fee is set.
    expect(priceFor(perPlayer, { kind: "free_agent" }, late)).toMatchObject({
      cents: 8500,
    });
    expect(
      priceFor(
        { ...perPlayer, freeAgentFeeCents: 9500 },
        { kind: "free_agent" },
        late,
      ),
    ).toMatchObject({ cents: 9500 });
    expect(
      priceFor(
        { ...perPlayer, playerFeeCents: null },
        { kind: "free_agent" },
        late,
      ),
    ).toEqual({ ok: false, error: "no_price" });
  });

  it("lets a captain pay the team fee in full or split it into fixed shares", () => {
    expect(priceFor(perTeam, captain("full"), late)).toEqual({
      ok: true,
      cents: 120_000,
      shareCents: null,
      earlyBird: false,
    });
    // $1,190 early bird over 14 players is $85 each, rounded up.
    expect(priceFor(perTeam, captain("split"), early)).toEqual({
      ok: true,
      cents: 8500,
      shareCents: 8500,
      earlyBird: true,
    });
    expect(
      priceFor(perTeam, { kind: "teammate", shareCents: 8600 }, late),
    ).toMatchObject({ cents: 8600 });
    expect(
      priceFor(perTeam, { kind: "teammate", shareCents: null }, late),
    ).toMatchObject({ cents: 0 });
    expect(priceFor(perTeam, { kind: "free_agent" }, late)).toMatchObject({
      cents: 9000,
    });
    expect(
      priceFor(
        { ...perTeam, freeAgentFeeCents: null },
        { kind: "free_agent" },
        late,
      ),
    ).toEqual({ ok: false, error: "no_price" });
    expect(
      priceFor({ ...perTeam, teamFeeCents: null }, captain("full"), late),
    ).toEqual({ ok: false, error: "no_price" });
  });

  it("never lets a discount go below zero", () => {
    expect(
      priceFor(
        { ...perPlayer, earlyBirdDiscountCents: 99_999 },
        { kind: "free_agent" },
        early,
      ),
    ).toMatchObject({ cents: 0 });
  });
});

describe("splitShare", () => {
  it("covers the fee in whole dollars, by less than a dollar a player", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 40 }),
        (fee, size) => {
          const share = splitShare(fee, size);
          expect(share % 100).toBe(0);
          expect(share * size).toBeGreaterThanOrEqual(fee);
          expect((share - 100) * size).toBeLessThan(fee);
        },
      ),
    );
    expect(() => splitShare(1000, 0)).toThrow();
  });
});

describe("formatCents", () => {
  it("shows whole dollars without cents", () => {
    expect(formatCents(8500)).toBe("$85");
    expect(formatCents(120_000)).toBe("$1,200");
    expect(formatCents(8550)).toBe("$85.50");
  });
});
