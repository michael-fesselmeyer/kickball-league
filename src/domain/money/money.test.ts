import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PricedSeason } from "../registration/pricing";
import { CARD_MINIMUM_CENTS } from "../registration/promo";
import {
  creditToApply,
  describeCredit,
  dollarsToCents,
  parseGoodwillForm,
} from "./credit";
import { chargeTime, guaranteeStep, type GuaranteeState } from "./guarantee";
import {
  DEFAULT_REBATE_THRESHOLD_PCT,
  isGameLost,
  quoteRebate,
  splitRebate,
} from "./rebate";
import { newReferralCode, normalizeReferralCode } from "./referral";
import { teamBalanceCents, teamFeeCents } from "./team-balance";
import {
  freeSpots,
  mayRegisterTeam,
  offerExpiry,
  offerIsLive,
  offersToSend,
} from "./waitlist";

const HOUR = 3_600_000;

describe("creditToApply", () => {
  it("uses the whole balance when it is less than the total", () => {
    expect(creditToApply(8500, 1000)).toBe(1000);
  });

  it("covers the whole total when the balance allows", () => {
    expect(creditToApply(8500, 9000)).toBe(8500);
  });

  it("never leaves a charge under the card minimum", () => {
    expect(creditToApply(8500, 8480)).toBe(8500 - CARD_MINIMUM_CENTS);
    expect(creditToApply(40, 30)).toBe(0);
  });

  it("uses nothing with no balance or nothing owed", () => {
    expect(creditToApply(8500, 0)).toBe(0);
    expect(creditToApply(0, 500)).toBe(0);
    expect(creditToApply(8500, -100)).toBe(0);
  });

  it("always leaves nothing or at least the minimum, within the balance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: -1000, max: 200_000 }),
        (total, balance) => {
          const credit = creditToApply(total, balance);
          const rest = total - credit;
          expect(credit).toBeGreaterThanOrEqual(0);
          expect(credit).toBeLessThanOrEqual(Math.max(0, balance));
          expect(
            rest === 0 || rest >= Math.min(total, CARD_MINIMUM_CENTS),
          ).toBe(true);
        },
      ),
    );
  });
});

describe("goodwill form", () => {
  it("reads dollars, a lower-cased email and a tidy note", () => {
    const parsed = parseGoodwillForm({
      email: " Pat@Example.TEST ",
      amount: "$12.5",
      note: "  Shirt  arrived late ",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        email: "pat@example.test",
        cents: 1250,
        note: "Shirt arrived late",
      },
    });
  });

  it("names every field that is wrong", () => {
    const parsed = parseGoodwillForm({ email: "nope", amount: "0", note: "" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(Object.keys(parsed.error).sort()).toEqual([
        "amount",
        "email",
        "note",
      ]);
    expect(
      parseGoodwillForm({ email: "a@example.test", amount: "501", note: "x" })
        .ok,
    ).toBe(false);
  });

  it("converts dollars to cents", () => {
    expect(dollarsToCents("7")).toBe(700);
    expect(dollarsToCents("7.05")).toBe(705);
    expect(dollarsToCents("7.5")).toBe(750);
    expect(dollarsToCents("7.555")).toBeNull();
    expect(dollarsToCents("-1")).toBeNull();
  });

  it("labels each kind of ledger row", () => {
    expect(describeCredit("rainout_rebate")).toBe("Rain-out rebate");
    expect(describeCredit("spent")).toBe("Used at checkout");
  });
});

const SEASON: PricedSeason = {
  status: "registration_open",
  feeModel: "per_team",
  teamFeeCents: 85_000,
  playerFeeCents: null,
  freeAgentFeeCents: 8500,
  earlyBirdEndsAt: new Date("2027-02-01T05:00:00Z"),
  earlyBirdDiscountCents: 10_000,
  registrationOpensAt: null,
  registrationClosesAt: null,
};

describe("team balance", () => {
  it("is the fee on the day the team registered, early bird included", () => {
    expect(teamFeeCents(SEASON, new Date("2027-01-15T12:00:00Z"))).toBe(75_000);
    expect(teamFeeCents(SEASON, new Date("2027-02-15T12:00:00Z"))).toBe(85_000);
    expect(
      teamFeeCents({ ...SEASON, teamFeeCents: null }, new Date()),
    ).toBeNull();
  });

  it("never goes below zero", () => {
    expect(teamBalanceCents(85_000, 60_000)).toBe(25_000);
    expect(teamBalanceCents(85_000, 85_200)).toBe(0);
  });
});

describe("rebates", () => {
  it("counts cancelled, unplaced and rained-out games as lost", () => {
    const g = (over: Partial<Parameters<typeof isGameLost>[0]>) =>
      isGameLost({
        status: "scheduled",
        placed: true,
        slotCancelled: false,
        ...over,
      });
    expect(g({})).toBe(false);
    expect(g({ status: "final" })).toBe(false);
    expect(g({ status: "forfeit", placed: false })).toBe(false);
    expect(g({ status: "cancelled" })).toBe(true);
    expect(g({ status: "postponed" })).toBe(true);
    expect(g({ placed: false })).toBe(true);
    expect(g({ slotCancelled: true })).toBe(true);
  });

  it("pays back the share lost once more than the threshold is lost", () => {
    const quote = (gamesLost: number) =>
      quoteRebate({
        gamesCount: 8,
        gamesLost,
        paidCents: 85_000,
        thresholdPct: DEFAULT_REBATE_THRESHOLD_PCT,
      });
    expect(quote(2)).toEqual({ lostPct: 25, eligible: false, rebateCents: 0 });
    expect(quote(3)).toEqual({
      lostPct: 37.5,
      eligible: true,
      rebateCents: 31_875,
    });
    expect(quote(0).eligible).toBe(false);
    expect(
      quoteRebate({
        gamesCount: 0,
        gamesLost: 0,
        paidCents: 1,
        thresholdPct: 25,
      }).rebateCents,
    ).toBe(0);
  });

  it("splits a rebate among payers in proportion, to the cent", () => {
    expect(
      splitRebate(1001, [
        { userId: "a", paidCents: 7100 },
        { userId: "b", paidCents: 7100 },
        { userId: "c", paidCents: 0 },
      ]),
    ).toEqual([
      { userId: "a", cents: 501 },
      { userId: "b", cents: 500 },
    ]);
    expect(splitRebate(0, [{ userId: "a", paidCents: 100 }])).toEqual([]);
  });

  it("never hands out more or less than the rebate", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        (rebate, paid) => {
          const payers = paid.map((p, i) => ({
            userId: `u${i}`,
            paidCents: p,
          }));
          const total = paid.reduce((s, p) => s + p, 0);
          const parts = splitRebate(rebate, payers);
          const handed = parts.reduce((s, p) => s + p.cents, 0);
          expect(handed).toBe(total === 0 ? 0 : Math.min(rebate, total));
          for (const part of parts) {
            const payer = payers.find((p) => p.userId === part.userId);
            expect(part.cents).toBeLessThanOrEqual(
              Math.ceil(((payer?.paidCents ?? 0) * rebate) / total) + 1,
            );
          }
        },
      ),
    );
  });
});

describe("waitlist", () => {
  const now = new Date("2027-02-10T12:00:00Z");

  it("holds an offer for 48 hours, by the clock", () => {
    const expires = offerExpiry(now);
    expect(expires.getTime() - now.getTime()).toBe(48 * HOUR);
    const offer = { status: "offered", offerExpiresAt: expires };
    expect(offerIsLive(offer, now)).toBe(true);
    expect(offerIsLive(offer, expires)).toBe(false);
    expect(offerIsLive({ ...offer, status: "waiting" }, now)).toBe(false);
  });

  it("offers each free spot to the next in line", () => {
    const spots = { maxTeams: 12, entered: 11, liveOffers: 0, waiting: 3 };
    expect(freeSpots(spots)).toBe(1);
    expect(offersToSend(spots)).toBe(1);
    expect(offersToSend({ ...spots, liveOffers: 1 })).toBe(0);
    expect(offersToSend({ ...spots, entered: 9 })).toBe(3);
    expect(offersToSend({ ...spots, maxTeams: null })).toBe(0);
  });

  it("lets nobody jump the line", () => {
    const full = { maxTeams: 12, entered: 12, liveOffers: 0, waiting: 0 };
    expect(mayRegisterTeam(full, false)).toBe(false);
    const open = { ...full, entered: 11 };
    expect(mayRegisterTeam(open, false)).toBe(true);
    expect(mayRegisterTeam({ ...open, waiting: 1 }, false)).toBe(false);
    const held = { ...open, liveOffers: 1 };
    expect(mayRegisterTeam(held, false)).toBe(false);
    expect(mayRegisterTeam(held, true)).toBe(true);
    // The admin lowered the limit after the offer went out.
    expect(mayRegisterTeam({ ...held, maxTeams: 11 }, true)).toBe(false);
    expect(mayRegisterTeam({ ...full, maxTeams: null }, false)).toBe(true);
  });
});

describe("captain guarantee", () => {
  const deadline = new Date("2027-03-01T04:59:00Z");
  const base: GuaranteeState = {
    deadline,
    balanceCents: 21_300,
    warnedForDeadline: null,
    warnedAt: null,
    charged: false,
  };
  const at = (hoursBefore: number) =>
    new Date(deadline.getTime() - hoursBefore * HOUR);

  it("warns 72 hours ahead, then charges at the deadline", () => {
    expect(guaranteeStep(base, at(100))).toBe("nothing");
    expect(guaranteeStep(base, at(72))).toBe("warn");
    const warned = { ...base, warnedForDeadline: deadline, warnedAt: at(72) };
    expect(guaranteeStep(warned, at(1))).toBe("wait");
    expect(guaranteeStep(warned, at(0))).toBe("charge");
    expect(chargeTime(deadline, at(72))).toEqual(deadline);
  });

  it("never charges without 72 hours' notice", () => {
    const late = { ...base, warnedForDeadline: deadline, warnedAt: at(10) };
    expect(guaranteeStep(late, at(0))).toBe("wait");
    expect(guaranteeStep(late, at(-61))).toBe("wait");
    expect(guaranteeStep(late, at(-62))).toBe("charge");
    expect(chargeTime(deadline, at(10))).toEqual(at(-62));
  });

  it("warns again when the deadline moves", () => {
    const old = new Date(deadline.getTime() - 7 * 24 * HOUR);
    const moved = { ...base, warnedForDeadline: old, warnedAt: at(300) };
    expect(guaranteeStep(moved, at(0))).toBe("warn");
  });

  it("does nothing once paid up, charged, or with no deadline", () => {
    expect(guaranteeStep({ ...base, balanceCents: 0 }, at(0))).toBe("nothing");
    expect(guaranteeStep({ ...base, charged: true }, at(0))).toBe("nothing");
    expect(guaranteeStep({ ...base, deadline: null }, at(0))).toBe("nothing");
  });
});

describe("referral codes", () => {
  it("are eight unambiguous characters and read back the same", () => {
    const code = newReferralCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(normalizeReferralCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(newReferralCode(() => 0)).toBe("AAAAAAAA");
  });

  it("refuse anything else", () => {
    for (const bad of ["", "ABCDEFG", "ABCDEFGHJ", "ABCDEF0O", 12_345_678])
      expect(normalizeReferralCode(bad)).toBeNull();
  });
});
