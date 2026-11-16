import { describe, expect, it } from "vitest";
import {
  bankFeeCents,
  bankProcessorFee,
  bpsText,
  cardFeeCents,
  DEFAULT_FEE_SETTINGS,
  type FeeSettings,
  feeFor,
  feeShareOfRefund,
  methodQuotes,
  parseFeeSettings,
  processorFee,
  readFeeSettings,
  refundForPrice,
  venmoFeeCents,
} from "./processing-fee";

const on: FeeSettings = { ...DEFAULT_FEE_SETTINGS, mode: "non_card_discount" };

describe("card fee", () => {
  it("lets the league net its price on a team fee", () => {
    // $750 by card: Stripe takes 2.9% + 30c of the total.
    const fee = cardFeeCents(75_000, on);
    const gross = 75_000 + fee;
    expect(fee).toBe(2270);
    expect(gross - processorFee(gross, on.card)).toBe(75_000);
  });

  it("never charges the payer more than the processor takes, at any price", () => {
    for (let net = 1; net <= 20_000; net += 1) {
      const fee = cardFeeCents(net, on);
      const gross = net + fee;
      const actual = processorFee(gross, on.card);
      expect(fee).toBeLessThanOrEqual(actual);
      // ...and the league nets its price exactly.
      expect(gross - actual).toBe(net);
    }
  });

  it("uses the league's own lower rate", () => {
    const nonprofit = { ...on, card: { percentBps: 220, fixedCents: 30 } };
    expect(cardFeeCents(10_000, nonprofit)).toBeLessThan(
      cardFeeCents(10_000, on),
    );
    const gross = 10_000 + cardFeeCents(10_000, nonprofit);
    expect(gross - processorFee(gross, nonprofit.card)).toBe(10_000);
  });

  it("is nothing on nothing", () => {
    expect(cardFeeCents(0, on)).toBe(0);
    expect(cardFeeCents(-5, on)).toBe(0);
  });

  it("charges only the fixed part when the rate has no percentage", () => {
    const flat = { ...on, card: { percentBps: 0, fixedCents: 30 } };
    expect(cardFeeCents(5000, flat)).toBe(30);
  });
});

describe("bank transfer fee", () => {
  it("is the percentage below the cap", () => {
    const fee = bankFeeCents(10_000, on);
    const gross = 10_000 + fee;
    expect(fee).toBe(80);
    expect(fee).toBeLessThanOrEqual(bankProcessorFee(gross, on.bank));
  });

  it("stops at Stripe's $5 cap on a large payment", () => {
    expect(bankFeeCents(75_000, on)).toBe(500);
  });

  it("never exceeds the processor's fee near the cap", () => {
    for (let net = 60_000; net <= 64_000; net += 7) {
      const fee = bankFeeCents(net, on);
      expect(fee).toBeLessThanOrEqual(bankProcessorFee(net + fee, on.bank));
    }
  });
});

describe("Venmo fee", () => {
  it("is nothing on a personal profile", () => {
    expect(venmoFeeCents(5000, on)).toBe(0);
  });

  it("covers a business profile's fee", () => {
    const business = { ...on, venmoBusiness: true };
    const fee = venmoFeeCents(5000, business);
    expect(5000 + fee - processorFee(5000 + fee, business.venmo)).toBe(5000);
  });
});

describe("feeFor", () => {
  it("is nothing for every method while the setting is off", () => {
    for (const method of ["card", "bank", "venmo", "cash", "zelle", "check"] as const)
      expect(
        feeFor(method, 75_000, {
          ...DEFAULT_FEE_SETTINGS,
          bankTransfers: true,
          venmoBusiness: true,
        }),
      ).toBe(0);
  });

  it("is nothing for cash, Zelle and check when on", () => {
    expect(feeFor("cash", 5000, on)).toBe(0);
    expect(feeFor("zelle", 5000, on)).toBe(0);
    expect(feeFor("check", 5000, on)).toBe(0);
  });

  it("charges no bank fee unless bank transfers are offered", () => {
    expect(feeFor("bank", 5000, on)).toBe(0);
    expect(feeFor("bank", 5000, { ...on, bankTransfers: true })).toBe(40);
  });
});

describe("methodQuotes", () => {
  it("is empty while off, so screens stay as they were", () => {
    expect(
      methodQuotes(5000, DEFAULT_FEE_SETTINGS, { bank: true, offApp: true }),
    ).toEqual([]);
  });

  it("lists the card price first, then the cheaper methods", () => {
    const quotes = methodQuotes(
      5000,
      { ...on, bankTransfers: true },
      { bank: true, offApp: true },
    );
    expect(quotes.map((q) => q.method)).toEqual([
      "card",
      "bank",
      "venmo",
      "zelle",
      "cash",
      "check",
    ]);
    expect(quotes[0]?.totalCents).toBe(5000 + cardFeeCents(5000, on));
    expect(quotes.find((q) => q.method === "cash")?.totalCents).toBe(5000);
  });

  it("leaves out bank transfers where they are not offered", () => {
    const quotes = methodQuotes(
      5000,
      { ...on, bankTransfers: true },
      { bank: false, offApp: false },
    );
    expect(quotes.map((q) => q.method)).toEqual(["card"]);
  });
});

describe("refunds", () => {
  it("returns the whole fee on a full refund", () => {
    expect(feeShareOfRefund(6211, 6211, 211)).toBe(211);
    expect(feeShareOfRefund(9999, 6211, 211)).toBe(211);
  });

  it("returns the same share of the fee on a partial refund", () => {
    // Half of what was paid returns half the fee, rounded down.
    expect(feeShareOfRefund(3105, 6211, 211)).toBe(105);
  });

  it("has no fee share when there was no fee", () => {
    expect(feeShareOfRefund(3000, 6000, 0)).toBe(0);
    expect(feeShareOfRefund(0, 6000, 211)).toBe(0);
  });

  it("works out the refund that gives back part of the price with its fee", () => {
    // Paid $62.11: $60 price and $2.11 fee. Refunding $30 of the price
    // gives back $1.06 of the fee with it (rounded).
    expect(refundForPrice(3000, 6211, 211)).toBe(3106);
    expect(refundForPrice(6000, 6211, 211)).toBe(6211);
    expect(refundForPrice(9000, 6211, 211)).toBe(6211);
    expect(refundForPrice(3000, 6000, 0)).toBe(3000);
  });
});

describe("readFeeSettings", () => {
  it("is off with Stripe's rates when nothing is stored", () => {
    expect(readFeeSettings(null)).toEqual(DEFAULT_FEE_SETTINGS);
    expect(readFeeSettings({})).toEqual(DEFAULT_FEE_SETTINGS);
  });

  it("treats an unknown mode as off and bad rates as the defaults", () => {
    const read = readFeeSettings({
      mode: "surcharge",
      card: { percentBps: -1, fixedCents: "30" },
      bank: { percentBps: 99_999 },
    });
    expect(read.mode).toBe("off");
    expect(read.card).toEqual(DEFAULT_FEE_SETTINGS.card);
    expect(read.bank).toEqual(DEFAULT_FEE_SETTINGS.bank);
  });

  it("keeps what an admin saved", () => {
    const saved = {
      ...on,
      card: { percentBps: 220, fixedCents: 30 },
      bankTransfers: true,
      freeMethodsNote: "Zelle to the league treasurer.",
    };
    expect(readFeeSettings(saved)).toEqual(saved);
  });
});

describe("parseFeeSettings", () => {
  const form =
    (values: Record<string, string>) =>
    (name: string): unknown =>
      values[name] ?? null;
  const valid = {
    mode: "non_card_discount",
    cardPercent: "2.9",
    cardFixed: "0.30",
    bankPercent: "0.8",
    bankCap: "5",
    venmoPercent: "1.9%",
    venmoFixed: "$0.10",
    bankTransfers: "on",
    freeMethodsNote: "  Cash to your captain.  ",
  };

  it("reads percentages and dollar amounts", () => {
    const parsed = parseFeeSettings(form(valid));
    expect(parsed).toEqual({
      ok: true,
      value: {
        mode: "non_card_discount",
        card: { percentBps: 290, fixedCents: 30 },
        bankTransfers: true,
        bank: { percentBps: 80, capCents: 500 },
        venmoBusiness: false,
        venmo: { percentBps: 190, fixedCents: 10 },
        freeMethodsNote: "Cash to your captain.",
      },
    });
  });

  it("refuses an unknown mode and rates that are not numbers", () => {
    expect(parseFeeSettings(form({ ...valid, mode: "surcharge" }))).toEqual({
      ok: false,
      error: "bad_mode",
    });
    expect(parseFeeSettings(form({ ...valid, cardPercent: "abc" }))).toEqual({
      ok: false,
      error: "bad_card_rate",
    });
    expect(parseFeeSettings(form({ ...valid, cardPercent: "11" }))).toEqual({
      ok: false,
      error: "bad_card_rate",
    });
    expect(parseFeeSettings(form({ ...valid, bankCap: "" }))).toEqual({
      ok: false,
      error: "bad_bank_rate",
    });
    expect(parseFeeSettings(form({ ...valid, venmoFixed: "-1" }))).toEqual({
      ok: false,
      error: "bad_venmo_rate",
    });
  });

  it("shows basis points as a percentage", () => {
    expect(bpsText(290)).toBe("2.9");
    expect(bpsText(300)).toBe("3");
    expect(bpsText(80)).toBe("0.8");
    expect(bpsText(1000)).toBe("10");
  });
});
