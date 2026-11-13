import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { creditToApply } from "@/domain/money/credit";
import { CARD_MINIMUM_CENTS } from "@/domain/registration/promo";
import {
  asDollars,
  checkoutExpiry,
  checkUpload,
  fitsUnderCap,
  holdUntil,
  type ItemForm,
  jerseyDefaults,
  leftInStock,
  MAX_PHOTOS_PER_ITEM,
  MAX_UPLOAD_BYTES,
  MERCH_PHOTO_CAP_BYTES,
  merchSizeLabel,
  type MerchSize,
  orderLine,
  orderWindow,
  parseItemForm,
  priceLine,
  unitPrice,
} from "./catalog";

const NOW = new Date("2027-03-01T17:00:00Z");
const TZ = "America/New_York";

const off = { offered: false, stock: "" };
const noSizes: ItemForm["sizes"] = {
  xs: off,
  s: off,
  m: off,
  l: off,
  xl: off,
  xxl: off,
  one_size: off,
};

const form = (over: Partial<ItemForm> = {}): ItemForm => ({
  kind: "league",
  name: "League shirt",
  description: "",
  price: "25",
  memberPrice: "",
  madeToOrder: false,
  deadline: "",
  sizes: { ...noSizes, m: { offered: true, stock: "10" } },
  ...over,
});

describe("parseItemForm", () => {
  it("reads a league shirt with stock per size", () => {
    const parsed = parseItemForm(
      form({
        memberPrice: "20",
        sizes: {
          ...noSizes,
          s: { offered: true, stock: "4" },
          l: { offered: true, stock: "0" },
        },
      }),
      TZ,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: "league",
        name: "League shirt",
        description: null,
        priceCents: 2500,
        memberPriceCents: 2000,
        madeToOrder: false,
        orderDeadline: null,
        sizes: [
          { size: "s", stock: 4 },
          { size: "l", stock: 0 },
        ],
      },
    });
  });

  it("closes orders at 11:59 PM on the deadline in the league's time zone", () => {
    const parsed = parseItemForm(form({ deadline: "2027-04-01" }), TZ);
    expect(parsed.ok && parsed.value.orderDeadline?.toISOString()).toBe(
      "2027-04-02T03:59:00.000Z",
    );
  });

  it("lets a made-to-order item leave stock blank", () => {
    const parsed = parseItemForm(
      form({
        kind: "team_jersey",
        madeToOrder: true,
        sizes: { ...noSizes, m: { offered: true, stock: "" } },
      }),
      TZ,
    );
    expect(parsed.ok && parsed.value.sizes).toEqual([{ size: "m", stock: 0 }]);
  });

  it.each<[Partial<ItemForm>, string]>([
    [{ kind: "poster" }, "kind"],
    [{ name: "  " }, "name"],
    [{ name: "x".repeat(81) }, "name"],
    [{ description: "x".repeat(501) }, "description"],
    [{ price: "" }, "price"],
    [{ price: "0.25" }, "price"],
    [{ price: "500.01" }, "price"],
    [{ price: "ten" }, "price"],
    [{ memberPrice: "30" }, "member_price"],
    [{ memberPrice: "0.10" }, "member_price"],
    [{ deadline: "2027-02-30" }, "deadline"],
    [{ deadline: "tomorrow" }, "deadline"],
    [{ sizes: noSizes }, "sizes"],
    [{ sizes: { ...noSizes, m: { offered: true, stock: "" } } }, "stock"],
    [{ sizes: { ...noSizes, m: { offered: true, stock: "-1" } } }, "stock"],
    [{ sizes: { ...noSizes, m: { offered: true, stock: "2.5" } } }, "stock"],
    [{ sizes: { ...noSizes, m: { offered: true, stock: "10001" } } }, "stock"],
  ])("refuses %o with %s", (over, error) => {
    expect(parseItemForm(form(over), TZ)).toEqual({ ok: false, error });
  });

  it("allows a free member price", () => {
    const parsed = parseItemForm(form({ memberPrice: "0" }), TZ);
    expect(parsed.ok && parsed.value.memberPriceCents).toBe(0);
  });
});

describe("prices", () => {
  const item = { priceCents: 2500, memberPriceCents: 2000 };

  it("charges members the member price and everyone else the price", () => {
    expect(unitPrice(item, true)).toBe(2000);
    expect(unitPrice(item, false)).toBe(2500);
    expect(unitPrice({ ...item, memberPriceCents: null }, true)).toBe(2500);
  });

  it("writes the price line", () => {
    expect(priceLine(item)).toBe("$25 ($20 for members)");
    expect(priceLine({ priceCents: 1250, memberPriceCents: null })).toBe(
      "$12.50",
    );
  });

  it("round-trips cents through the form", () => {
    expect(asDollars(2500)).toBe("25");
    expect(asDollars(1250)).toBe("12.50");
    expect(asDollars(null)).toBe("");
  });

  it("never leaves a card charge below Stripe's minimum after credit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: CARD_MINIMUM_CENTS, max: 50_000 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 300_000 }),
        (unit, quantity, balance) => {
          const total = unit * quantity;
          const credit = creditToApply(total, balance);
          const card = total - credit;
          expect(credit).toBeGreaterThanOrEqual(0);
          expect(credit).toBeLessThanOrEqual(Math.min(total, balance));
          expect(card === 0 || card >= CARD_MINIMUM_CENTS).toBe(true);
        },
      ),
    );
  });
});

describe("stock", () => {
  it("is the stock less what is taken, never below zero", () => {
    expect(leftInStock({ madeToOrder: false }, 10, 3)).toBe(7);
    expect(leftInStock({ madeToOrder: false }, 2, 3)).toBe(0);
  });

  it("has no limit for an item made to order", () => {
    expect(leftInStock({ madeToOrder: true }, 0, 40)).toBeNull();
  });
});

describe("orderWindow", () => {
  it("is open until the deadline and closed from it", () => {
    const deadline = new Date(NOW.getTime() + 1000);
    expect(orderWindow({ hiddenAt: null, orderDeadline: deadline }, NOW)).toBe(
      "open",
    );
    expect(
      orderWindow({ hiddenAt: null, orderDeadline: deadline }, deadline),
    ).toBe("closed");
    expect(orderWindow({ hiddenAt: NOW, orderDeadline: null }, NOW)).toBe(
      "hidden",
    );
  });
});

describe("orderLine", () => {
  const item = {
    name: "League shirt",
    priceCents: 2500,
    memberPriceCents: 2000,
    madeToOrder: false,
    hiddenAt: null,
    orderDeadline: null,
  };
  const sizes: { size: MerchSize; left: number | null }[] = [
    { size: "m", left: 2 },
    { size: "l", left: 0 },
  ];

  it("prices a member's order of two", () => {
    expect(
      orderLine(item, sizes, {
        size: "m",
        quantity: "2",
        member: true,
        now: NOW,
      }),
    ).toEqual({
      ok: true,
      value: {
        size: "m",
        quantity: 2,
        unitCents: 2000,
        amountCents: 4000,
        description: "League shirt (M) × 2",
      },
    });
  });

  it("leaves the size out of a one-size item's description", () => {
    const line = orderLine(
      { ...item, name: "Hat" },
      [{ size: "one_size", left: null }],
      { size: "one_size", quantity: 1, member: false, now: NOW },
    );
    expect(line.ok && line.value.description).toBe("Hat");
  });

  it.each<[unknown, unknown, string]>([
    ["xl", "1", "size"],
    ["m", "0", "quantity"],
    ["m", "6", "quantity"],
    ["m", "1.5", "quantity"],
    ["m", "3", "sold_out"],
    ["l", "1", "sold_out"],
  ])("refuses size %s, quantity %s with %s", (size, quantity, error) => {
    expect(
      orderLine(item, sizes, { size, quantity, member: false, now: NOW }),
    ).toEqual({ ok: false, error });
  });

  it("refuses after the deadline", () => {
    expect(
      orderLine({ ...item, orderDeadline: NOW }, sizes, {
        size: "m",
        quantity: 1,
        member: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "closed" });
  });

  it("never sells more than is left", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 1, max: 5 }),
        (stock, taken, quantity) => {
          const left = leftInStock(item, stock, taken);
          const line = orderLine(item, [{ size: "m", left }], {
            size: "m",
            quantity,
            member: false,
            now: NOW,
          });
          if (line.ok) expect(taken + quantity).toBeLessThanOrEqual(stock);
        },
      ),
    );
  });
});

describe("jerseyDefaults", () => {
  const teams = [
    { teamSeasonId: "newest", name: "Kick Ash" },
    { teamSeasonId: "older", name: "Ball Busters" },
  ];

  it("starts with the newest team and the profile's size", () => {
    expect(jerseyDefaults(teams, "l", ["m", "l"])).toEqual({
      team: teams[0],
      size: "l",
    });
  });

  it("leaves the size unpicked when the item doesn't come in it", () => {
    expect(jerseyDefaults(teams, "xxl", ["m", "l"]).size).toBeNull();
    expect(jerseyDefaults([], null, ["m"])).toEqual({ team: null, size: null });
  });
});

describe("photos", () => {
  const photo = { size: 1_000_000, type: "image/jpeg" };

  it("takes a JPEG, PNG or WebP up to the upload limit", () => {
    expect(checkUpload(photo, 0).ok).toBe(true);
    expect(checkUpload({ ...photo, size: MAX_UPLOAD_BYTES + 1 }, 0)).toEqual({
      ok: false,
      error: "too_big",
    });
    expect(checkUpload({ ...photo, type: "image/svg+xml" }, 0)).toEqual({
      ok: false,
      error: "not_image",
    });
    expect(checkUpload({ ...photo, size: 0 }, 0)).toEqual({
      ok: false,
      error: "not_image",
    });
    expect(checkUpload(photo, MAX_PHOTOS_PER_ITEM)).toEqual({
      ok: false,
      error: "too_many",
    });
  });

  it("stops at the cap on all merch photos", () => {
    expect(fitsUnderCap(MERCH_PHOTO_CAP_BYTES - 10, 10)).toBe(true);
    expect(fitsUnderCap(MERCH_PHOTO_CAP_BYTES - 10, 11)).toBe(false);
  });
});

describe("holds", () => {
  it("holds stock past Stripe's checkout expiry", () => {
    expect(holdUntil(NOW).getTime()).toBeGreaterThan(
      checkoutExpiry(NOW).getTime(),
    );
    expect(checkoutExpiry(NOW).getTime() - NOW.getTime()).toBeGreaterThan(
      30 * 60_000,
    );
  });
});

describe("merchSizeLabel", () => {
  it("names sizes the way a shirt tag does", () => {
    expect(merchSizeLabel("xxl")).toBe("XXL");
    expect(merchSizeLabel("one_size")).toBe("One size");
  });
});
