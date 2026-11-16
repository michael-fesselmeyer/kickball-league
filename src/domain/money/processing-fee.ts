import { err, ok, type Result } from "../result";

/**
 * Processing fees (ADR 0093, product-spec.md "Processing fees"). When a
 * league turns the setting on, whoever pays with a method that costs the
 * league a fee covers it, worked out so the league nets its price, and
 * cash, Zelle and check cost the price alone. Pure: the caller passes the
 * league's settings and the amount being charged.
 *
 * The fee never exceeds what the processor charges for the payment: of the
 * totals that come close, the largest whose fee to the payer is no more
 * than the processor's own fee on that total is used, so when rounding
 * leaves no exact answer the league nets a cent less instead of the payer
 * paying a cent more.
 */

/** "off" changes nothing. "non_card_discount" is two-tier pricing (ADR 0093). */
export const FEE_MODES = ["off", "non_card_discount"] as const;
export type FeeMode = (typeof FEE_MODES)[number];

/** A processor's price: a percentage in basis points plus a fixed part. */
export type PercentRate = { percentBps: number; fixedCents: number };

export type FeeSettings = {
  mode: FeeMode;
  /** Card, Apple Pay and Google Pay through Stripe. */
  card: PercentRate;
  /** Offer Stripe bank transfers (ACH) for season fees. */
  bankTransfers: boolean;
  /** Stripe bank transfers: a percentage capped at an amount. */
  bank: { percentBps: number; capCents: number };
  /** Venmo's price when the league takes Venmo on a business profile. */
  venmoBusiness: boolean;
  venmo: PercentRate;
  /** What to tell payers about cash, Zelle and check: who, where, how. */
  freeMethodsNote: string;
};

/** Stripe's and Venmo's published US prices when this was written. */
export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  mode: "off",
  card: { percentBps: 290, fixedCents: 30 },
  bankTransfers: false,
  bank: { percentBps: 80, capCents: 500 },
  venmoBusiness: false,
  venmo: { percentBps: 190, fixedCents: 10 },
  freeMethodsNote: "",
};

/** Online methods a fee is worked out for. */
export const FEE_METHODS = ["card", "bank"] as const;
export type FeeMethod = (typeof FEE_METHODS)[number];

/** Every way to pay, in the order a payer sees them. */
export type PayMethod = "card" | "bank" | "venmo" | "cash" | "zelle" | "check";

const NOTE_MAX = 500;

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * The league's stored settings, with anything missing or out of range taken
 * from the defaults, so a half-written row never charges a wrong fee. An
 * unknown mode is off.
 */
export function readFeeSettings(stored: unknown): FeeSettings {
  const d = DEFAULT_FEE_SETTINGS;
  const s =
    stored && typeof stored === "object"
      ? (stored as Record<string, unknown>)
      : {};
  const part = (key: string) =>
    s[key] && typeof s[key] === "object"
      ? (s[key] as Record<string, unknown>)
      : {};
  const card = part("card");
  const bank = part("bank");
  const venmo = part("venmo");
  const mode = FEE_MODES.find((m) => m === s.mode) ?? "off";
  return {
    mode,
    card: {
      percentBps: intIn(card.percentBps, 0, 1000) ?? d.card.percentBps,
      fixedCents: intIn(card.fixedCents, 0, 500) ?? d.card.fixedCents,
    },
    bankTransfers: s.bankTransfers === true,
    bank: {
      percentBps: intIn(bank.percentBps, 0, 1000) ?? d.bank.percentBps,
      capCents: intIn(bank.capCents, 0, 10_000) ?? d.bank.capCents,
    },
    venmoBusiness: s.venmoBusiness === true,
    venmo: {
      percentBps: intIn(venmo.percentBps, 0, 1000) ?? d.venmo.percentBps,
      fixedCents: intIn(venmo.fixedCents, 0, 500) ?? d.venmo.fixedCents,
    },
    freeMethodsNote:
      typeof s.freeMethodsNote === "string"
        ? s.freeMethodsNote.trim().slice(0, NOTE_MAX)
        : "",
  };
}

/** Whether payers cover fees at all. */
export function feesOn(settings: FeeSettings): boolean {
  return settings.mode !== "off";
}

/** The processor's fee on a gross amount, its percentage rounded down. */
export function processorFee(grossCents: number, rate: PercentRate): number {
  if (grossCents <= 0) return 0;
  return Math.floor((grossCents * rate.percentBps) / 10_000) + rate.fixedCents;
}

/** Stripe's bank-transfer fee on a gross amount: a percentage with a cap. */
export function bankProcessorFee(
  grossCents: number,
  rate: FeeSettings["bank"],
): number {
  if (grossCents <= 0) return 0;
  return Math.min(
    rate.capCents,
    Math.floor((grossCents * rate.percentBps) / 10_000),
  );
}

/**
 * The fee a payer covers so the league nets `netCents`, for a processor
 * whose fee on a gross amount is `feeOn`. Of the totals near the answer, the
 * largest whose fee to the payer is no more than the processor's own fee is
 * chosen.
 */
function coveringFee(netCents: number, feeOn: (gross: number) => number) {
  if (netCents <= 0) return 0;
  // The processor's fee rises by at most a cent for each cent of gross (its
  // percentage is under 100%), so the payer's fee less the processor's
  // never falls as the gross rises: find where it first goes over zero.
  const fits = (gross: number) => gross - netCents <= feeOn(gross);
  let lo = netCents;
  let hi = netCents + 1;
  while (fits(hi)) {
    lo = hi;
    hi = netCents + (hi - netCents) * 2;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo - netCents;
}

/** What a card payer covers on top of `netCents`. */
export function cardFeeCents(netCents: number, settings: FeeSettings): number {
  return coveringFee(netCents, (g) => processorFee(g, settings.card));
}

/** What a bank-transfer payer covers on top of `netCents`. */
export function bankFeeCents(netCents: number, settings: FeeSettings): number {
  return coveringFee(netCents, (g) => bankProcessorFee(g, settings.bank));
}

/** What a Venmo payer covers, when Venmo is a business profile. */
export function venmoFeeCents(netCents: number, settings: FeeSettings): number {
  if (!settings.venmoBusiness) return 0;
  return coveringFee(netCents, (g) => processorFee(g, settings.venmo));
}

/**
 * The fee for paying `netCents` with a method. Nothing while the setting
 * is off, and nothing for cash, Zelle or check.
 */
export function feeFor(
  method: PayMethod,
  netCents: number,
  settings: FeeSettings,
): number {
  if (!feesOn(settings) || netCents <= 0) return 0;
  switch (method) {
    case "card":
      return cardFeeCents(netCents, settings);
    case "bank":
      return settings.bankTransfers ? bankFeeCents(netCents, settings) : 0;
    case "venmo":
      return venmoFeeCents(netCents, settings);
    default:
      return 0;
  }
}

export type MethodQuote = {
  method: PayMethod;
  label: string;
  feeCents: number;
  totalCents: number;
};

const LABELS: Record<PayMethod, string> = {
  card: "Card, Apple Pay or Google Pay",
  bank: "Bank transfer",
  venmo: "Venmo",
  cash: "Cash",
  zelle: "Zelle",
  check: "Check",
};

export function methodLabel(method: PayMethod): string {
  return LABELS[method];
}

/**
 * The total for each way to pay `netCents`, card first (the card price is
 * the posted price under two-tier pricing), then the cheaper ones. Empty
 * while the setting is off: the screens stay as they were.
 */
export function methodQuotes(
  netCents: number,
  settings: FeeSettings,
  options: { bank: boolean; offApp: boolean },
): MethodQuote[] {
  if (!feesOn(settings) || netCents <= 0) return [];
  const methods: PayMethod[] = ["card"];
  if (options.bank && settings.bankTransfers) methods.push("bank");
  if (options.offApp) methods.push("venmo", "zelle", "cash", "check");
  return methods.map((method) => {
    const feeCents = feeFor(method, netCents, settings);
    return {
      method,
      label: LABELS[method],
      feeCents,
      totalCents: netCents + feeCents,
    };
  });
}

/**
 * The share of a refund that is fee: the same share of the fee as the
 * refund is of what was paid, rounded down, so a full refund returns the
 * whole fee and a partial one its part.
 */
export function feeShareOfRefund(
  refundedCents: number,
  paidCents: number,
  feeCents: number,
): number {
  if (refundedCents <= 0 || paidCents <= 0 || feeCents <= 0) return 0;
  if (refundedCents >= paidCents) return feeCents;
  return Math.floor((feeCents * refundedCents) / paidCents);
}

/**
 * The refund that gives back `priceCents` of the price with its share of
 * the fee, for the refund screen. Never more than was paid.
 */
export function refundForPrice(
  priceCents: number,
  paidCents: number,
  feeCents: number,
): number {
  const price = paidCents - feeCents;
  if (priceCents <= 0 || price <= 0) return 0;
  if (priceCents >= price) return paidCents;
  return Math.min(
    paidCents,
    priceCents + Math.round((feeCents * priceCents) / price),
  );
}

export type FeeSettingsError =
  "bad_mode" | "bad_card_rate" | "bad_bank_rate" | "bad_venmo_rate";

/** "2.9" or "2.90" percent to basis points; null if not a percent. */
function percentToBps(raw: unknown): number | null {
  const value = typeof raw === "string" ? raw.trim().replace(/%$/, "") : "";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return null;
  const [whole = "0", part = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return bps <= 1000 ? bps : null;
}

/** "0.30" or "$0.30" dollars to cents; null if not an amount. */
function dollarsToCents(raw: unknown, max: number): number | null {
  const value = typeof raw === "string" ? raw.trim().replace(/^\$/, "") : "";
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole = "0", part = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return cents <= max ? cents : null;
}

/** The settings an admin typed, checked. */
export function parseFeeSettings(
  form: (name: string) => unknown,
): Result<FeeSettings, FeeSettingsError> {
  const mode = FEE_MODES.find((m) => m === form("mode"));
  if (!mode) return err("bad_mode");
  const cardPct = percentToBps(form("cardPercent"));
  const cardFixed = dollarsToCents(form("cardFixed"), 500);
  if (cardPct === null || cardFixed === null) return err("bad_card_rate");
  const bankPct = percentToBps(form("bankPercent"));
  const bankCap = dollarsToCents(form("bankCap"), 10_000);
  if (bankPct === null || bankCap === null) return err("bad_bank_rate");
  const venmoPct = percentToBps(form("venmoPercent"));
  const venmoFixed = dollarsToCents(form("venmoFixed"), 500);
  if (venmoPct === null || venmoFixed === null) return err("bad_venmo_rate");
  const note = form("freeMethodsNote");
  return ok({
    mode,
    card: { percentBps: cardPct, fixedCents: cardFixed },
    bankTransfers: form("bankTransfers") === "on",
    bank: { percentBps: bankPct, capCents: bankCap },
    venmoBusiness: form("venmoBusiness") === "on",
    venmo: { percentBps: venmoPct, fixedCents: venmoFixed },
    freeMethodsNote:
      typeof note === "string" ? note.trim().slice(0, NOTE_MAX) : "",
  });
}

/** "2.9%" from basis points, for the settings form. */
export function bpsText(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}`;
}
