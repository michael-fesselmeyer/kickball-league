import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { creditEntry } from "@/db/schema/credit";
import { merchItem, merchItemSize, merchOrder } from "@/db/schema/merch";
import { payment, purchase, refund } from "@/db/schema/money";
import type { LeagueId } from "@/domain/ids";
import type { MerchSize } from "@/domain/merch/catalog";
import type { SeedData } from "./generate";

/**
 * The demo shop (ADR 0037): a league shirt sold from stock with a member
 * price, a replacement team jersey made to order, and a hat. No photos, so
 * nothing binary is committed; nobody has ordered yet.
 */
export const SEED_MERCH = [
  {
    kind: "league",
    name: "League shirt",
    description:
      "The season shirt in heather gray, with the league badge on the front.",
    priceCents: 2500,
    memberPriceCents: 2000,
    madeToOrder: false,
    sizes: [
      ["s", 6],
      ["m", 10],
      ["l", 10],
      ["xl", 4],
    ],
  },
  {
    kind: "team_jersey",
    name: "Replacement team jersey",
    description:
      "Lost yours or joined late? A jersey in your team's color, printed with the next batch.",
    priceCents: 1800,
    memberPriceCents: null,
    madeToOrder: true,
    sizes: [
      ["xs", 0],
      ["s", 0],
      ["m", 0],
      ["l", 0],
      ["xl", 0],
      ["xxl", 0],
    ],
  },
  {
    kind: "league",
    name: "Dad hat",
    description: null,
    priceCents: 2000,
    memberPriceCents: null,
    madeToOrder: false,
    sizes: [["one_size", 12]],
  },
] as const satisfies readonly {
  kind: "league" | "team_jersey";
  name: string;
  description: string | null;
  priceCents: number;
  memberPriceCents: number | null;
  madeToOrder: boolean;
  sizes: readonly (readonly [MerchSize, number])[];
}[];

export async function addMerchDemo(db: Db, data: SeedData): Promise<void> {
  for (const { sizes, ...item } of SEED_MERCH) {
    const [created] = await db
      .insert(merchItem)
      .values({ ...item, leagueId: data.league.id })
      .returning({ id: merchItem.id });
    if (!created) throw new Error("Seed merch: item not created");
    await db
      .insert(merchItemSize)
      .values(
        sizes.map(([size, stock]) => ({ itemId: created.id, size, stock })),
      );
  }
}

/**
 * Removes a league's shop: its orders and the money behind them (credit
 * used, refunds, payments and purchases), then its items with their sizes
 * and photos. Orders point at people and teams, so this runs before they
 * are deleted.
 */
export async function removeSeedMerch(db: Db, leagueId: LeagueId) {
  const items = db
    .select({ id: merchItem.id })
    .from(merchItem)
    .where(eq(merchItem.leagueId, leagueId));
  const purchaseIds = (
    await db
      .select({ id: merchOrder.purchaseId })
      .from(merchOrder)
      .where(inArray(merchOrder.itemId, items))
  ).map((o) => o.id);
  await db.delete(merchOrder).where(inArray(merchOrder.itemId, items));
  if (purchaseIds.length > 0) {
    const payments = db
      .select({ id: payment.id })
      .from(payment)
      .where(inArray(payment.purchaseId, purchaseIds));
    await db
      .delete(creditEntry)
      .where(inArray(creditEntry.purchaseId, purchaseIds));
    await db.delete(refund).where(inArray(refund.paymentId, payments));
    await db.delete(payment).where(inArray(payment.purchaseId, purchaseIds));
    await db.delete(purchase).where(inArray(purchase.id, purchaseIds));
  }
  await db.delete(merchItem).where(eq(merchItem.leagueId, leagueId));
}
