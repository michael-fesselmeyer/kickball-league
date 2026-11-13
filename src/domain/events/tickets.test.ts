import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { creditToApply } from "@/domain/money/credit";
import {
  CHECKOUT_MINUTES,
  checkInCode,
  checkoutExpiry,
  CODE_ALPHABET,
  formatCode,
  FREE,
  freeSpots,
  HOLD_GRACE_MINUTES,
  holdsSpot,
  holdUntil,
  isTicketed,
  normalizeCode,
  OFFER_HOURS,
  offersToMake,
  offerUntil,
  parseTicketPrices,
  placeForBuyer,
  priceLine,
  ticketPrice,
  ticketPriceFormValues,
} from "./tickets";

const NOW = new Date("2027-03-01T17:00:00Z");

describe("parseTicketPrices", () => {
  const parse = (price: string, memberPrice = "") =>
    parseTicketPrices({ price, memberPrice }, "bar_night");

  it("reads a blank price as a free event", () => {
    expect(parse("")).toEqual({ ok: true, value: FREE });
    expect(parse("  ")).toEqual({ ok: true, value: FREE });
  });

  it("reads dollars and cents, with or without a dollar sign", () => {
    expect(parse("15")).toEqual({
      ok: true,
      value: { ticketPriceCents: 1500, memberPriceCents: null },
    });
    expect(parse("$12.50", "10")).toEqual({
      ok: true,
      value: { ticketPriceCents: 1250, memberPriceCents: 1000 },
    });
  });

  it("refuses a price no card could pay, or over the most a ticket costs", () => {
    for (const price of ["0", "0.49", "500.01", "abc", "-5", "1.234"])
      expect(parse(price)).toEqual({ ok: false, error: "price" });
    expect(parse("0.50").ok).toBe(true);
    expect(parse("500").ok).toBe(true);
  });

  it("takes a member price up to the ticket price, or free for members", () => {
    expect(parse("15", "0")).toEqual({
      ok: true,
      value: { ticketPriceCents: 1500, memberPriceCents: 0 },
    });
    expect(parse("15", "15").ok).toBe(true);
    for (const member of ["15.01", "0.25", "nope"])
      expect(parse("15", member)).toEqual({
        ok: false,
        error: "member_price",
      });
  });

  it("refuses a member price on a free event", () => {
    expect(parse("", "5")).toEqual({ ok: false, error: "member_price" });
  });

  it("keeps a theme week free whatever was typed", () => {
    expect(
      parseTicketPrices({ price: "15", memberPrice: "5" }, "theme_week"),
    ).toEqual({ ok: true, value: FREE });
  });

  it("reads back what the form shows", () => {
    for (const prices of [
      FREE,
      { ticketPriceCents: 1500, memberPriceCents: null },
      { ticketPriceCents: 1250, memberPriceCents: 0 },
      { ticketPriceCents: 999, memberPriceCents: 50 },
    ])
      expect(parseTicketPrices(ticketPriceFormValues(prices), "party")).toEqual(
        { ok: true, value: prices },
      );
  });
});

describe("ticketPrice and priceLine", () => {
  const prices = { ticketPriceCents: 1500, memberPriceCents: 1000 };

  it("charges members the member price and everyone else the full one", () => {
    expect(ticketPrice(prices, true)).toBe(1000);
    expect(ticketPrice(prices, false)).toBe(1500);
    expect(
      ticketPrice({ ticketPriceCents: 1500, memberPriceCents: null }, true),
    ).toBe(1500);
    expect(ticketPrice(FREE, true)).toBeNull();
    expect(isTicketed(FREE)).toBe(false);
    expect(isTicketed(prices)).toBe(true);
  });

  it("writes the price for a page or a card", () => {
    expect(priceLine(FREE)).toBeNull();
    expect(priceLine({ ticketPriceCents: 1500, memberPriceCents: null })).toBe(
      "$15",
    );
    expect(priceLine(prices)).toBe("$15 ($10 for members)");
    expect(priceLine({ ticketPriceCents: 1250, memberPriceCents: 0 })).toBe(
      "Free for members, $12.50 otherwise",
    );
    expect(priceLine({ ticketPriceCents: 1500, memberPriceCents: 1500 })).toBe(
      "$15",
    );
  });

  it("leaves a card charge Stripe can take after any credit", () => {
    // The checkout uses the registration rule: credit never leaves a charge
    // between nothing and the card minimum.
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 50_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (price, balance) => {
          const credit = creditToApply(price, balance);
          const card = price - credit;
          return credit <= balance && (card === 0 || card >= 50);
        },
      ),
    );
  });
});

describe("holds and offers", () => {
  it("holds a checkout's spot past Stripe's expiry by the grace period", () => {
    expect(checkoutExpiry(NOW).getTime() - NOW.getTime()).toBe(
      CHECKOUT_MINUTES * 60_000,
    );
    // Stripe's shortest checkout is 30 minutes.
    expect(CHECKOUT_MINUTES).toBeGreaterThanOrEqual(30);
    expect(holdUntil(NOW).getTime() - checkoutExpiry(NOW).getTime()).toBe(
      HOLD_GRACE_MINUTES * 60_000,
    );
  });

  it("gives an offer a day, but never past the event's end", () => {
    const later = new Date("2027-03-10T00:00:00Z");
    expect(offerUntil(NOW, later).getTime() - NOW.getTime()).toBe(
      OFFER_HOURS * 3_600_000,
    );
    const soon = new Date("2027-03-01T20:00:00Z");
    expect(offerUntil(NOW, soon)).toEqual(soon);
  });

  it("counts a paid ticket, and a hold or offer only until it runs out", () => {
    const until = new Date(NOW.getTime() + 60_000);
    expect(holdsSpot({ status: "paid", heldUntil: null }, NOW)).toBe(true);
    for (const status of ["held", "offered"] as const) {
      expect(holdsSpot({ status, heldUntil: until }, NOW)).toBe(true);
      expect(holdsSpot({ status, heldUntil: NOW }, NOW)).toBe(false);
      expect(holdsSpot({ status, heldUntil: null }, NOW)).toBe(false);
    }
    for (const status of ["refunded", "released", "cancelled"] as const)
      expect(holdsSpot({ status, heldUntil: until }, NOW)).toBe(false);
  });
});

describe("placeForBuyer and offersToMake", () => {
  it("sends a buyer to checkout while a spot is free and nobody waits", () => {
    expect(
      placeForBuyer({ capacity: 2, going: 1, held: 0, waitlisted: 0 }),
    ).toBe("checkout");
    expect(
      placeForBuyer({ capacity: null, going: 90, held: 9, waitlisted: 0 }),
    ).toBe("checkout");
  });

  it("counts held spots as taken", () => {
    expect(
      placeForBuyer({ capacity: 2, going: 1, held: 1, waitlisted: 0 }),
    ).toBe("waitlist");
  });

  it("puts a newcomer behind anyone already in line", () => {
    expect(
      placeForBuyer({ capacity: 3, going: 1, held: 0, waitlisted: 1 }),
    ).toBe("waitlist");
  });

  it("offers each free spot to one person in line", () => {
    expect(
      offersToMake({ capacity: 3, going: 1, held: 1, waitlisted: 5 }),
    ).toBe(1);
    expect(
      offersToMake({ capacity: 3, going: 3, held: 0, waitlisted: 5 }),
    ).toBe(0);
    expect(
      offersToMake({ capacity: 9, going: 1, held: 0, waitlisted: 2 }),
    ).toBe(2);
  });

  it("never lets spots taken and offered pass the capacity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (capacity, going, held, waitlisted) => {
          const spots = { capacity, going, held, waitlisted };
          const offers = offersToMake(spots);
          const free = freeSpots(spots) ?? 0;
          const taken = going + held;
          return (
            offers <= waitlisted &&
            (taken >= capacity ? offers === 0 : taken + offers <= capacity) &&
            (placeForBuyer(spots) === "checkout") ===
              (free > 0 && waitlisted === 0)
          );
        },
      ),
    );
  });
});

describe("check-in codes", () => {
  const bytes = (values: number[]) => () => Uint8Array.from(values);

  it("spells six letters and numbers that can't be misread", () => {
    const code = checkInCode(bytes([0, 1, 2, 30, 31, 32]), new Set());
    expect(code).toBe("ABC89A");
    expect(CODE_ALPHABET).not.toMatch(/[01IO]/);
    expect(CODE_ALPHABET).toHaveLength(32);
  });

  it("skips a code the event already uses", () => {
    let call = 0;
    const next = () =>
      Uint8Array.from(call++ === 0 ? [0, 0, 0, 0, 0, 0] : [1, 1, 1, 1, 1, 1]);
    expect(checkInCode(next, new Set(["AAAAAA"]))).toBe("BBBBBB");
  });

  it("reads a code typed at the door however it was spaced or cased", () => {
    expect(formatCode("K7M4QX")).toBe("K7M 4QX");
    expect(normalizeCode(" k7m 4qx ")).toBe("K7M4QX");
    expect(normalizeCode("K7M-4QX")).toBe("K7M4QX");
    for (const bad of ["", "K7M4Q", "K7M4QXX", "K7M40X", "K7M4IX"])
      expect(normalizeCode(bad)).toBeNull();
  });

  it("always makes a code the database accepts", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 6, maxLength: 6 }), (raw) => {
        const code = checkInCode(() => raw, new Set());
        return /^[A-HJ-NP-Z2-9]{6}$/.test(code) && normalizeCode(code) === code;
      }),
    );
  });
});
