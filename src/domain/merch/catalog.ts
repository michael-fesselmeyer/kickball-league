import { CHECKOUT_MINUTES, HOLD_GRACE_MINUTES } from "@/domain/events/tickets";
import { dollarsToCents } from "@/domain/money/credit";
import { CARD_MINIMUM_CENTS } from "@/domain/registration/promo";
import { formatCents } from "@/domain/registration/pricing";
import { err, ok, type Result } from "@/domain/result";
import type { ShirtSize } from "@/domain/shirts/summary";
import { zonedInstant } from "@/domain/time/zoned";

/**
 * Merch and replacement jersey orders (docs/product-spec.md, section 6;
 * ADR 0035). The league keeps a small catalog; a player orders one item in
 * one size per checkout. An item either has a stock per size, or is made
 * to order and has no limit. Pure, so the rules are tested without a
 * database.
 */

export const MERCH_SIZES = [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "xxl",
  "one_size",
] as const;
export type MerchSize = (typeof MERCH_SIZES)[number];

export const MERCH_KINDS = ["league", "team_jersey"] as const;
export type MerchKind = (typeof MERCH_KINDS)[number];

export const MERCH_KIND_LABEL: Readonly<Record<MerchKind, string>> = {
  league: "League item (the same for everyone)",
  team_jersey: "Replacement team jersey (in the buyer's team color)",
};

/** "m" → "M"; "one_size" → "One size". */
export const merchSizeLabel = (size: MerchSize): string =>
  size === "one_size" ? "One size" : size.toUpperCase();

export const isMerchSize = (value: unknown): value is MerchSize =>
  typeof value === "string" &&
  (MERCH_SIZES as readonly string[]).includes(value);

export const isMerchKind = (value: unknown): value is MerchKind =>
  typeof value === "string" &&
  (MERCH_KINDS as readonly string[]).includes(value);

/** The most an item can cost: $500. */
export const MERCH_MAX_CENTS = 50_000;
/** The most of one size in one order. */
export const MAX_QUANTITY = 5;
/** The most stock an admin can enter for one size. */
export const MAX_STOCK = 10_000;

/**
 * Photos are stored in Postgres like the Instagram copies (ADR 0023): one
 * WebP at most 1000 px wide. These caps keep them inside the free database
 * tier, beside the Instagram copies' 25 MB.
 */
export const MAX_PHOTOS_PER_ITEM = 4;
/** What an admin may upload for one photo, before it is shrunk. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** All merch photos together, as stored. */
export const MERCH_PHOTO_CAP_BYTES = 10 * 1024 * 1024;

/** A checkout is open this long, and its stock held a while after. */
export function checkoutExpiry(now: Date): Date {
  return new Date(now.getTime() + CHECKOUT_MINUTES * 60_000);
}
export function holdUntil(now: Date): Date {
  return new Date(checkoutExpiry(now).getTime() + HOLD_GRACE_MINUTES * 60_000);
}

export type MerchPrices = {
  priceCents: number;
  memberPriceCents: number | null;
};

/** What one costs this buyer: the member price when they are a member. */
export function unitPrice(item: MerchPrices, member: boolean): number {
  return member && item.memberPriceCents !== null
    ? item.memberPriceCents
    : item.priceCents;
}

/** "$25 ($20 for members)", or "$25". */
export function priceLine(item: MerchPrices): string {
  return item.memberPriceCents === null
    ? formatCents(item.priceCents)
    : `${formatCents(item.priceCents)} (${formatCents(item.memberPriceCents)} for members)`;
}

/**
 * How many of a size are left: the stock less what is sold (paid,
 * fulfilled, or held for an open checkout). Null for an item made to
 * order, which has no limit. Never below zero, even if a late payment
 * was honored after its hold ran out.
 */
export function leftInStock(
  item: { madeToOrder: boolean },
  stock: number,
  taken: number,
): number | null {
  if (item.madeToOrder) return null;
  return Math.max(0, stock - taken);
}

export type OrderWindow = "open" | "hidden" | "closed";

/** Whether the item takes orders now: shown, and before its deadline. */
export function orderWindow(
  item: { hiddenAt: Date | null; orderDeadline: Date | null },
  now: Date,
): OrderWindow {
  if (item.hiddenAt !== null) return "hidden";
  if (item.orderDeadline !== null && item.orderDeadline <= now) return "closed";
  return "open";
}

export type OrderError =
  OrderWindow | "size" | "quantity" | "sold_out" | "no_team";

/**
 * Checks an order against the item and what is left, and prices it. The
 * line's amount is the unit price times the quantity; credit comes off at
 * checkout.
 */
export function orderLine(
  item: MerchPrices & {
    name: string;
    madeToOrder: boolean;
    hiddenAt: Date | null;
    orderDeadline: Date | null;
  },
  sizes: readonly { size: MerchSize; left: number | null }[],
  order: { size: unknown; quantity: unknown; member: boolean; now: Date },
): Result<
  {
    size: MerchSize;
    quantity: number;
    unitCents: number;
    amountCents: number;
    description: string;
  },
  OrderError
> {
  const window = orderWindow(item, order.now);
  if (window !== "open") return err(window);
  const offered = sizes.find((s) => s.size === order.size);
  if (!offered) return err("size");
  const quantity = parseQuantity(order.quantity);
  if (quantity === null) return err("quantity");
  if (offered.left !== null && offered.left < quantity) return err("sold_out");
  const unitCents = unitPrice(item, order.member);
  const size =
    offered.size === "one_size" ? "" : ` (${merchSizeLabel(offered.size)})`;
  return ok({
    size: offered.size,
    quantity,
    unitCents,
    amountCents: unitCents * quantity,
    description: `${item.name}${size}${quantity > 1 ? ` × ${quantity}` : ""}`,
  });
}

function parseQuantity(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d{1,2}$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY ? n : null;
}

/**
 * What a replacement jersey's order form starts with: the newest team the
 * player is on, and their shirt size from their profile when the item
 * comes in it.
 */
export function jerseyDefaults<T extends { teamSeasonId: string }>(
  teams: readonly T[],
  profileSize: ShirtSize | null,
  sizes: readonly MerchSize[],
): { team: T | null; size: MerchSize | null } {
  return {
    team: teams[0] ?? null,
    size:
      profileSize !== null && sizes.includes(profileSize) ? profileSize : null,
  };
}

export type ItemForm = {
  kind: string;
  name: string;
  description: string;
  price: string;
  memberPrice: string;
  madeToOrder: boolean;
  /** YYYY-MM-DD; orders close at the end of that day. Blank for none. */
  deadline: string;
  /** Per size: whether it's offered, and the stock as typed. */
  sizes: Readonly<Record<MerchSize, { offered: boolean; stock: string }>>;
};

export type ItemValues = {
  kind: MerchKind;
  name: string;
  description: string | null;
  priceCents: number;
  memberPriceCents: number | null;
  madeToOrder: boolean;
  orderDeadline: Date | null;
  sizes: { size: MerchSize; stock: number }[];
};

export type ItemFormError =
  | "kind"
  | "name"
  | "description"
  | "price"
  | "member_price"
  | "deadline"
  | "sizes"
  | "stock";

export const ITEM_FORM_ERRORS: Readonly<Record<ItemFormError, string>> = {
  kind: "Choose what kind of item this is.",
  name: "Give the item a name of up to 80 characters.",
  description: "Keep the description to 500 characters.",
  price: `An item costs from ${formatCents(CARD_MINIMUM_CENTS)} to ${formatCents(MERCH_MAX_CENTS)}.`,
  member_price: `The member price is $0, or from ${formatCents(CARD_MINIMUM_CENTS)} up to the price. Leave it blank if members pay the same.`,
  deadline: "Pick a real date for the order deadline, or leave it blank.",
  sizes: "Offer at least one size.",
  stock: `Stock is a whole number from 0 to ${MAX_STOCK} for each size offered.`,
};

const FORM_MESSAGES = new Map<string, string>(Object.entries(ITEM_FORM_ERRORS));

/** The words for an item form error code from the address, if it is one. */
export const itemFormMessage = (code: unknown): string | null =>
  typeof code === "string" ? (FORM_MESSAGES.get(code) ?? null) : null;

/**
 * Checks the admin's item form. The deadline is a date: orders close at
 * 11:59 PM that day in the league's time zone.
 */
export function parseItemForm(
  form: ItemForm,
  timeZone: string,
): Result<ItemValues, ItemFormError> {
  if (!isMerchKind(form.kind)) return err("kind");
  const name = form.name.trim();
  if (name.length < 1 || name.length > 80) return err("name");
  const description = form.description.trim();
  if (description.length > 500) return err("description");
  const priceCents = dollarsToCents(form.price);
  if (
    priceCents === null ||
    priceCents < CARD_MINIMUM_CENTS ||
    priceCents > MERCH_MAX_CENTS
  )
    return err("price");
  let memberPriceCents: number | null = null;
  if (form.memberPrice.trim() !== "") {
    memberPriceCents = dollarsToCents(form.memberPrice);
    if (
      memberPriceCents === null ||
      memberPriceCents > priceCents ||
      (memberPriceCents > 0 && memberPriceCents < CARD_MINIMUM_CENTS)
    )
      return err("member_price");
  }
  let orderDeadline: Date | null = null;
  const deadline = form.deadline.trim();
  if (deadline !== "") {
    if (!isRealDate(deadline)) return err("deadline");
    orderDeadline = zonedInstant(deadline, "23:59", timeZone);
  }
  const sizes: { size: MerchSize; stock: number }[] = [];
  for (const size of MERCH_SIZES) {
    const entry = form.sizes[size];
    if (!entry.offered) continue;
    const typed = entry.stock.trim();
    const stock = form.madeToOrder && typed === "" ? 0 : Number(typed);
    if (
      typed !== "" &&
      (!/^\d+$/.test(typed) || stock > MAX_STOCK || !Number.isInteger(stock))
    )
      return err("stock");
    if (!form.madeToOrder && typed === "") return err("stock");
    sizes.push({ size, stock });
  }
  if (sizes.length === 0) return err("sizes");
  return ok({
    kind: form.kind,
    name,
    description: description === "" ? null : description,
    priceCents,
    memberPriceCents,
    madeToOrder: form.madeToOrder,
    orderDeadline,
    sizes,
  });
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Cents as the form shows them: "12" or "12.50"; blank for none. */
export const asDollars = (cents: number | null): string =>
  cents === null
    ? ""
    : cents % 100 === 0
      ? String(cents / 100)
      : (cents / 100).toFixed(2);

export type PhotoError = "too_many" | "too_big" | "not_image" | "full" | "alt";

export const PHOTO_ERRORS: Readonly<Record<PhotoError, string>> = {
  too_many: `An item has at most ${MAX_PHOTOS_PER_ITEM} photos. Remove one first.`,
  too_big: `Photos can be up to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
  not_image: "That file isn't a JPEG, PNG or WebP photo.",
  full: "Merch photo storage is full. Remove photos from hidden items first.",
  alt: "Describe the photo in a few words, for people who can't see it.",
};

/** Whether an upload may be stored, before it is shrunk. */
export function checkUpload(
  upload: { size: number; type: string },
  photosOnItem: number,
): Result<void, PhotoError> {
  if (photosOnItem >= MAX_PHOTOS_PER_ITEM) return err("too_many");
  if (upload.size > MAX_UPLOAD_BYTES) return err("too_big");
  if (
    upload.size === 0 ||
    !["image/jpeg", "image/png", "image/webp"].includes(upload.type)
  )
    return err("not_image");
  return ok(undefined);
}

/** Whether a shrunk photo still fits under the cap on all merch photos. */
export const fitsUnderCap = (
  usedBytes: number,
  size: number,
  cap = MERCH_PHOTO_CAP_BYTES,
): boolean => usedBytes + size <= cap;
