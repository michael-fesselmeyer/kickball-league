import type { Column } from "@/domain/export/csv";
import { isOneOf } from "@/domain/guards";
import { type MerchSize, merchSizeLabel } from "@/domain/merch/catalog";
import { dollarsToCents } from "@/domain/money/credit";
import { err, ok, type Result } from "@/domain/result";
import { SHIRT_SIZES, type ShirtSize, sizeLabel } from "./summary";

/**
 * A season's shirt order (product-spec.md, section 6, "Shirt tracking"):
 * the sizes players pick from, counts by size for the whole league and for
 * each team, and the vendor's CSV. Pure, so the rules are tested without a
 * database. A player's size is the one on their profile, which every
 * sign-up form asks for from the season's list.
 */

/** What a season offers when its admins have not changed the list. */
export const DEFAULT_SEASON_SIZES: readonly ShirtSize[] = [
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "xxl",
];

/**
 * The sizes an admin ticked, in the fixed order smallest first. At least
 * one: a season without sizes could never take an order.
 */
export function parseSeasonSizes(
  picked: readonly unknown[],
): Result<ShirtSize[], "no_sizes"> {
  const sizes = SHIRT_SIZES.filter((size) => picked.includes(size));
  return sizes.length > 0 ? ok(sizes) : err("no_sizes");
}

/** The size a sign-up form sent, if it is one the season offers. */
export function pickSize(
  raw: unknown,
  offered: readonly ShirtSize[],
): ShirtSize | null {
  return isOneOf(SHIRT_SIZES, raw) && offered.includes(raw) ? raw : null;
}

/**
 * A player's size for this season's order: their profile's size when the
 * season offers it; otherwise they still need to pick one.
 */
export function seasonSize(
  profileSize: ShirtSize | null,
  offered: readonly ShirtSize[],
): ShirtSize | null {
  return profileSize !== null && offered.includes(profileSize)
    ? profileSize
    : null;
}

export type SizeCounts = {
  bySize: Partial<Record<ShirtSize, number>>;
  /** Players with no size the season offers. */
  missing: number;
  total: number;
};

/** How many of each offered size a group of players needs. */
export function countSizes(
  players: readonly { size: ShirtSize | null }[],
  offered: readonly ShirtSize[],
): SizeCounts {
  const counts: SizeCounts = { bySize: {}, missing: 0, total: players.length };
  for (const p of players) {
    const size = seasonSize(p.size, offered);
    if (size === null) counts.missing++;
    else counts.bySize[size] = (counts.bySize[size] ?? 0) + 1;
  }
  return counts;
}

export type OrderPlayer = { name: string; size: ShirtSize | null };

export type OrderTeam = {
  name: string;
  colorHex: string | null;
  players: readonly OrderPlayer[];
};

export type OrderJersey = {
  name: string;
  teamName: string | null;
  colorHex: string | null;
  size: MerchSize;
  quantity: number;
};

export type VendorRow = {
  item: "Season shirt" | "Replacement jersey";
  team: string;
  color: string | null;
  size: string;
  quantity: number;
  /** Only when the admin asks for names, for packing by team. */
  name: string | null;
};

export const NO_TEAM = "No team yet";

/**
 * The vendor's rows: season shirts by team and size, then paid replacement
 * jerseys by team and size, each a count. Players without a size are left
 * out; the screen lists them. With names, one row per player or jersey
 * order instead, so the vendor can pack each team's bag.
 */
export function vendorRows(
  input: {
    teams: readonly OrderTeam[];
    /** Registered players on no team yet. */
    unplaced: readonly OrderPlayer[];
    jerseys: readonly OrderJersey[];
    offered: readonly ShirtSize[];
  },
  includeNames: boolean,
): VendorRow[] {
  const rows: VendorRow[] = [];
  const groups: OrderTeam[] = [
    ...input.teams,
    ...(input.unplaced.length > 0
      ? [{ name: NO_TEAM, colorHex: null, players: input.unplaced }]
      : []),
  ];
  for (const team of groups) {
    const sized = team.players.flatMap((p) => {
      const size = seasonSize(p.size, input.offered);
      return size ? [{ name: p.name, size }] : [];
    });
    for (const size of input.offered) {
      const these = sized.filter((p) => p.size === size);
      if (these.length === 0) continue;
      const base = {
        item: "Season shirt" as const,
        team: team.name,
        color: team.colorHex,
        size: sizeLabel(size),
      };
      if (includeNames)
        rows.push(
          ...[...these]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => ({ ...base, quantity: 1, name: p.name })),
        );
      else rows.push({ ...base, quantity: these.length, name: null });
    }
  }
  const jerseyGroups = new Map<string, VendorRow>();
  for (const j of input.jerseys) {
    const team = j.teamName ?? NO_TEAM;
    const row: VendorRow = {
      item: "Replacement jersey",
      team,
      color: j.colorHex,
      size: merchSizeLabel(j.size),
      quantity: j.quantity,
      name: includeNames ? j.name : null,
    };
    if (includeNames) {
      rows.push(row);
      continue;
    }
    const key = `${team}/${j.colorHex ?? ""}/${j.size}`;
    const seen = jerseyGroups.get(key);
    if (seen) seen.quantity += j.quantity;
    else jerseyGroups.set(key, row);
  }
  rows.push(...jerseyGroups.values());
  return rows;
}

/** The vendor's CSV columns; the name column only when names are asked for. */
export function vendorColumns(includeNames: boolean): Column<VendorRow>[] {
  const columns: Column<VendorRow>[] = [
    { header: "Item", value: (r) => r.item },
    { header: "Team", value: (r) => r.team },
    { header: "Team color", value: (r) => r.color },
    { header: "Size", value: (r) => r.size },
    { header: "Quantity", value: (r) => r.quantity },
  ];
  if (includeNames) columns.push({ header: "Name", value: (r) => r.name });
  return columns;
}

export type OrderForm = { cost: string; vendor: string };

export type OrderFormError = "cost" | "vendor";

export const ORDER_FORM_ERRORS: Readonly<Record<OrderFormError, string>> = {
  cost: "Enter what the order cost in dollars, such as 812.50, or leave it blank.",
  vendor: "Keep the vendor's name to 80 characters.",
};

/** The cost and vendor typed when the order is placed; both optional. */
export function parseOrderForm(
  form: OrderForm,
): Result<{ costCents: number | null; vendor: string | null }, OrderFormError> {
  const typed = form.cost.trim();
  const costCents = typed === "" ? null : dollarsToCents(typed);
  if (
    typed !== "" &&
    (costCents === null || costCents < 1 || costCents > 10_000_000)
  )
    return err("cost");
  const vendor = form.vendor.trim();
  if (vendor.length > 80) return err("vendor");
  return ok({ costCents, vendor: vendor === "" ? null : vendor });
}

export type OrderStatus = "not_placed" | "placed" | "received";

export const ORDER_STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  not_placed: "Not placed yet",
  placed: "Placed",
  received: "Received",
};

/** The note on the books expense made from an order. */
export const expenseNote = (seasonName: string, vendor: string | null) =>
  `${seasonName} shirt order${vendor ? ` from ${vendor}` : ""}`;
