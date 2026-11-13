import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type {
  LeagueId,
  MerchImageId,
  MerchItemId,
  MerchOrderId,
  PaymentId,
  PurchaseId,
  RefundId,
  TeamSeasonId,
  UserId,
} from "@/domain/ids";
import {
  checkoutExpiry,
  fitsUnderCap,
  holdUntil,
  type ItemValues,
  leftInStock,
  MAX_PHOTOS_PER_ITEM,
  type MerchKind,
  type MerchSize,
  merchSizeLabel,
  type OrderError,
  orderLine,
  type PhotoError,
} from "@/domain/merch/catalog";
import { centsToAmount, type Column } from "@/domain/export/csv";
import { moneyLine } from "@/domain/money/credit";
import { err, ok, type Result } from "@/domain/result";
import type { ShirtSize } from "@/domain/shirts/summary";
import type { MerchPayload } from "@/emails/merch";
import { user } from "../schema/auth";
import {
  merchImage,
  merchItem,
  merchItemSize,
  merchOrder,
} from "../schema/merch";
import { payment, purchase, purchaseItem } from "../schema/money";
import { profile } from "../schema/profile";
import { season } from "../schema/season";
import {
  registration,
  rosterMembership,
  team,
  teamSeason,
} from "../schema/team";
import { recordAudit } from "./audit";
import { returnSpentCredit } from "./credit";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import { closePurchases, startPurchase } from "./payments";
import {
  confirmStripeRefund,
  type RefundStartError,
  startRefund,
} from "./refunds";
import type { Db } from "./schedule";

/**
 * Merch and replacement jersey orders (docs/data-model.md, section 2.3;
 * ADR 0037). Every change to an item's stock or orders locks the item row
 * first, so two people ordering the last shirt at once can't both get it.
 * An order is paid only by the Stripe webhook, or by league credit that
 * covers it.
 */

/** Sold, or held for a checkout that is still open: what counts against stock. */
const takes = (now: Date) =>
  or(
    inArray(merchOrder.status, ["paid", "fulfilled"]),
    and(eq(merchOrder.status, "held"), gt(merchOrder.heldUntil, now)),
  );

export type CatalogSize = {
  size: MerchSize;
  stock: number;
  taken: number;
  /** Null for an item made to order. */
  left: number | null;
};

export type CatalogItem = {
  id: MerchItemId;
  kind: MerchKind;
  name: string;
  description: string | null;
  priceCents: number;
  memberPriceCents: number | null;
  madeToOrder: boolean;
  orderDeadline: Date | null;
  hiddenAt: Date | null;
  sizes: CatalogSize[];
  photos: { id: MerchImageId; alt: string; sha256: string }[];
};

/**
 * The league's items with their sizes, what is left of each, and their
 * photos: four queries, read in parallel, whatever the number of items.
 * Hidden items only when asked (the admin's list).
 */
export async function catalog(
  db: Db,
  leagueId: LeagueId,
  now: Date,
  options: { hidden: boolean; itemId?: MerchItemId },
): Promise<CatalogItem[]> {
  const items = await db
    .select({
      id: merchItem.id,
      kind: merchItem.kind,
      name: merchItem.name,
      description: merchItem.description,
      priceCents: merchItem.priceCents,
      memberPriceCents: merchItem.memberPriceCents,
      madeToOrder: merchItem.madeToOrder,
      orderDeadline: merchItem.orderDeadline,
      hiddenAt: merchItem.hiddenAt,
    })
    .from(merchItem)
    .where(
      and(
        eq(merchItem.leagueId, leagueId),
        options.hidden ? undefined : isNull(merchItem.hiddenAt),
        options.itemId ? eq(merchItem.id, options.itemId) : undefined,
      ),
    )
    .orderBy(sql`${merchItem.hiddenAt} is not null`, asc(merchItem.createdAt));
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  const [sizes, taken, photos] = await Promise.all([
    db
      .select({
        itemId: merchItemSize.itemId,
        size: merchItemSize.size,
        stock: merchItemSize.stock,
      })
      .from(merchItemSize)
      .where(inArray(merchItemSize.itemId, ids))
      .orderBy(asc(merchItemSize.size)),
    db
      .select({
        itemId: merchOrder.itemId,
        size: merchOrder.size,
        n: sql<number>`sum(${merchOrder.quantity})::int`,
      })
      .from(merchOrder)
      .where(and(inArray(merchOrder.itemId, ids), takes(now)))
      .groupBy(merchOrder.itemId, merchOrder.size),
    db
      .select({
        id: merchImage.id,
        itemId: merchImage.itemId,
        alt: merchImage.alt,
        sha256: merchImage.sha256,
      })
      .from(merchImage)
      .where(inArray(merchImage.itemId, ids))
      .orderBy(asc(merchImage.position)),
  ]);
  const takenOf = new Map(taken.map((t) => [`${t.itemId}/${t.size}`, t.n]));
  return items.map((item) => ({
    ...item,
    sizes: sizes
      .filter((s) => s.itemId === item.id)
      .map((s) => {
        const n = takenOf.get(`${item.id}/${s.size}`) ?? 0;
        return {
          size: s.size,
          stock: s.stock,
          taken: n,
          left: leftInStock(item, s.stock, n),
        };
      }),
    photos: photos
      .filter((p) => p.itemId === item.id)
      .map(({ id, alt, sha256 }) => ({ id, alt, sha256 })),
  }));
}

/** One item, hidden or not. */
export async function catalogItem(
  db: Db,
  leagueId: LeagueId,
  itemId: MerchItemId,
  now: Date,
  options: { hidden: boolean },
): Promise<CatalogItem | null> {
  const [found] = await catalog(db, leagueId, now, { ...options, itemId });
  return found ?? null;
}

const itemAudit = (v: ItemValues) => ({
  kind: v.kind,
  name: v.name,
  priceCents: v.priceCents,
  memberPriceCents: v.memberPriceCents,
  madeToOrder: v.madeToOrder,
  orderDeadline: v.orderDeadline?.toISOString() ?? null,
  sizes: v.sizes,
});

/** Adds an item to the catalog. */
export async function createMerchItem(
  db: Db,
  input: { leagueId: LeagueId; values: ItemValues; actorId: UserId },
): Promise<MerchItemId> {
  const { sizes, ...fields } = input.values;
  const [created] = await db
    .insert(merchItem)
    .values({ ...fields, leagueId: input.leagueId, createdBy: input.actorId })
    .returning({ id: merchItem.id });
  if (!created) throw new Error("The item was not created");
  await db
    .insert(merchItemSize)
    .values(sizes.map((s) => ({ ...s, itemId: created.id })));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "merch.item_create",
    entityType: "merch_item",
    entityId: created.id,
    after: itemAudit(input.values),
  });
  return created.id;
}

/**
 * Changes an item. Sizes no longer offered stop selling; orders already
 * placed in them stay. Locks the item, so stock never changes under an
 * order being placed.
 */
export async function updateMerchItem(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    values: ItemValues;
    actorId: UserId;
  },
): Promise<Result<void, "not_found">> {
  const before = await lockItem(db, input.itemId);
  if (!before || before.leagueId !== input.leagueId) return err("not_found");
  const oldSizes = await db
    .select({ size: merchItemSize.size, stock: merchItemSize.stock })
    .from(merchItemSize)
    .where(eq(merchItemSize.itemId, input.itemId))
    .orderBy(asc(merchItemSize.size));
  const { sizes, ...fields } = input.values;
  await db.update(merchItem).set(fields).where(eq(merchItem.id, input.itemId));
  await db.delete(merchItemSize).where(eq(merchItemSize.itemId, input.itemId));
  await db
    .insert(merchItemSize)
    .values(sizes.map((s) => ({ ...s, itemId: input.itemId })));
  await recordAudit(db, {
    actorId: input.actorId,
    action: "merch.item_update",
    entityType: "merch_item",
    entityId: input.itemId,
    before: {
      kind: before.kind,
      name: before.name,
      priceCents: before.priceCents,
      memberPriceCents: before.memberPriceCents,
      madeToOrder: before.madeToOrder,
      orderDeadline: before.orderDeadline?.toISOString() ?? null,
      sizes: oldSizes,
    },
    after: itemAudit(input.values),
  });
  return ok(undefined);
}

/** Hides an item from the shop, or shows it again. Its orders stay. */
export async function setItemHidden(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    hidden: boolean;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<void, "not_found">> {
  const item = await lockItem(db, input.itemId);
  if (!item || item.leagueId !== input.leagueId) return err("not_found");
  if ((item.hiddenAt !== null) === input.hidden) return ok(undefined);
  await db
    .update(merchItem)
    .set({ hiddenAt: input.hidden ? input.now : null })
    .where(eq(merchItem.id, input.itemId));
  await recordAudit(db, {
    actorId: input.actorId,
    action: input.hidden ? "merch.item_hide" : "merch.item_show",
    entityType: "merch_item",
    entityId: input.itemId,
  });
  return ok(undefined);
}

async function lockItem(db: Db, itemId: MerchItemId) {
  const [found] = await db
    .select()
    .from(merchItem)
    .where(eq(merchItem.id, itemId))
    .for("update");
  return found ?? null;
}

/**
 * Stores a photo already shrunk to one WebP (compressPhoto). At most a few
 * per item, and never past the cap on all merch photos.
 */
export async function addMerchPhoto(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    bytes: Buffer;
    alt: string;
    actorId: UserId;
  },
): Promise<Result<MerchImageId, PhotoError | "not_found">> {
  const alt = input.alt.trim();
  if (alt.length < 1 || alt.length > 200) return err("alt");
  // Every photo upload locks the league's items as a whole, in id order,
  // so two uploads can't both fit under the cap when only one does, and
  // two uploads to different items can't deadlock.
  const items = await db
    .select({ id: merchItem.id })
    .from(merchItem)
    .where(eq(merchItem.leagueId, input.leagueId))
    .orderBy(asc(merchItem.id))
    .for("update");
  if (!items.some((i) => i.id === input.itemId)) return err("not_found");
  const mine = await db
    .select({ position: merchImage.position })
    .from(merchImage)
    .where(eq(merchImage.itemId, input.itemId));
  if (mine.length >= MAX_PHOTOS_PER_ITEM) return err("too_many");
  if (!fitsUnderCap(await photoBytesUsed(db), input.bytes.length))
    return err("full");
  const [created] = await db
    .insert(merchImage)
    .values({
      itemId: input.itemId,
      position: Math.max(0, ...mine.map((m) => m.position + 1)),
      alt,
      contentType: "image/webp",
      bytes: input.bytes,
      byteSize: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
    })
    .returning({ id: merchImage.id });
  if (!created) throw new Error("The photo was not stored");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "merch.photo_add",
    entityType: "merch_item",
    entityId: input.itemId,
    after: { imageId: created.id, bytes: input.bytes.length, alt },
  });
  return ok(created.id);
}

export async function removeMerchPhoto(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    imageId: MerchImageId;
    actorId: UserId;
  },
): Promise<Result<void, "not_found">> {
  const item = await lockItem(db, input.itemId);
  if (!item || item.leagueId !== input.leagueId) return err("not_found");
  const [gone] = await db
    .delete(merchImage)
    .where(
      and(
        eq(merchImage.id, input.imageId),
        eq(merchImage.itemId, input.itemId),
      ),
    )
    .returning({ alt: merchImage.alt });
  if (!gone) return err("not_found");
  await recordAudit(db, {
    actorId: input.actorId,
    action: "merch.photo_remove",
    entityType: "merch_item",
    entityId: input.itemId,
    before: { imageId: input.imageId, alt: gone.alt },
  });
  return ok(undefined);
}

/** A stored photo, and whether its item is in the shop. */
export async function merchPhoto(db: Db, imageId: MerchImageId) {
  const [found] = await db
    .select({
      contentType: merchImage.contentType,
      bytes: merchImage.bytes,
      sha256: merchImage.sha256,
      hiddenAt: merchItem.hiddenAt,
    })
    .from(merchImage)
    .innerJoin(merchItem, eq(merchItem.id, merchImage.itemId))
    .where(eq(merchImage.id, imageId));
  return found ? { ...found, shown: found.hiddenAt === null } : null;
}

/** How much of the merch photo cap is used, for the admin's page. */
export async function photoBytesUsed(db: Db): Promise<number> {
  const [row] = await db
    .select({
      bytes: sql<number>`coalesce(sum(${merchImage.byteSize}), 0)::int`,
    })
    .from(merchImage);
  return row?.bytes ?? 0;
}

export type PlayerTeam = {
  teamSeasonId: TeamSeasonId;
  name: string;
  colorHex: string | null;
  seasonName: string;
};

/**
 * The teams a player is on in seasons not yet over, newest season first:
 * the teams a replacement jersey can be for.
 */
export async function playerTeams(
  db: Db,
  userId: UserId,
): Promise<PlayerTeam[]> {
  return db
    .select({
      teamSeasonId: teamSeason.id,
      name: team.name,
      colorHex: team.colorHex,
      seasonName: season.name,
    })
    .from(rosterMembership)
    .innerJoin(
      registration,
      eq(registration.id, rosterMembership.registrationId),
    )
    .innerJoin(teamSeason, eq(teamSeason.id, rosterMembership.teamSeasonId))
    .innerJoin(team, eq(team.id, teamSeason.teamId))
    .innerJoin(season, eq(season.id, teamSeason.seasonId))
    .where(
      and(
        eq(registration.userId, userId),
        eq(rosterMembership.status, "active"),
        inArray(registration.status, [
          "pending_waiver",
          "pending_payment",
          "active",
        ]),
        ne(season.status, "completed"),
      ),
    )
    .orderBy(desc(season.startsOn), asc(team.name));
}

/** The shirt size on a player's profile. */
export async function profileShirtSize(
  db: Db,
  userId: UserId,
): Promise<ShirtSize | null> {
  const [found] = await db
    .select({ size: profile.shirtSize })
    .from(profile)
    .where(eq(profile.userId, userId));
  return found?.size ?? null;
}

/**
 * Checkouts for this item whose hold ran out: they no longer count against
 * stock, so they are released and their credit given back. Call it with
 * the item locked.
 */
async function releaseLapsed(db: Db, itemId: MerchItemId, now: Date) {
  const lapsed = await db
    .update(merchOrder)
    .set({ status: "released", heldUntil: null })
    .where(
      and(
        eq(merchOrder.itemId, itemId),
        eq(merchOrder.status, "held"),
        lte(merchOrder.heldUntil, now),
      ),
    )
    .returning({ purchaseId: merchOrder.purchaseId });
  await closePurchases(
    db,
    lapsed.map((o) => o.purchaseId),
  );
}

export type MerchOrderError = OrderError | "not_found" | "team";

export type PlaceOutcome =
  /** Off to Stripe Checkout, which is open until expiresAt. */
  | {
      kind: "checkout";
      orderId: MerchOrderId;
      purchaseId: PurchaseId;
      totalCents: number;
      creditCents: number;
      description: string;
      expiresAt: Date;
    }
  /** Credit or a free member price covered it: the order is in. */
  | { kind: "paid"; orderId: MerchOrderId }
  /** They have a checkout for this item still open. */
  | { kind: "open_checkout"; purchaseId: PurchaseId };

/**
 * Places an order for the signed-in player. With the item locked: lapsed
 * checkouts are released, what is left of the size is counted, and the
 * order holds its stock while its checkout is open. League credit comes
 * off unless they unticked it. A replacement jersey is for one of the
 * player's teams, in its color. Run it in a transaction.
 */
export async function placeMerchOrder(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    userId: UserId;
    member: boolean;
    size: unknown;
    quantity: unknown;
    teamSeasonId: TeamSeasonId | null;
    useCredit: boolean;
    now: Date;
  },
): Promise<Result<PlaceOutcome, MerchOrderError>> {
  const item = await lockItem(db, input.itemId);
  if (!item || item.leagueId !== input.leagueId) return err("not_found");
  await releaseLapsed(db, item.id, input.now);

  const [open] = await db
    .select({ purchaseId: merchOrder.purchaseId })
    .from(merchOrder)
    .where(
      and(
        eq(merchOrder.itemId, item.id),
        eq(merchOrder.userId, input.userId),
        eq(merchOrder.status, "held"),
      ),
    );
  if (open) return ok({ kind: "open_checkout", purchaseId: open.purchaseId });

  let jersey: PlayerTeam | null = null;
  if (item.kind === "team_jersey") {
    const teams = await playerTeams(db, input.userId);
    if (teams.length === 0) return err("no_team");
    jersey =
      teams.find((t) => t.teamSeasonId === input.teamSeasonId) ??
      (input.teamSeasonId === null ? (teams[0] ?? null) : null);
    if (!jersey) return err("team");
  }

  // In the transaction, one query after the other.
  const sizes = await db
    .select({ size: merchItemSize.size, stock: merchItemSize.stock })
    .from(merchItemSize)
    .where(eq(merchItemSize.itemId, item.id));
  const taken = await db
    .select({
      size: merchOrder.size,
      n: sql<number>`sum(${merchOrder.quantity})::int`,
    })
    .from(merchOrder)
    .where(and(eq(merchOrder.itemId, item.id), takes(input.now)))
    .groupBy(merchOrder.size);
  const line = orderLine(
    item,
    sizes.map((s) => ({
      size: s.size,
      left: leftInStock(
        item,
        s.stock,
        taken.find((t) => t.size === s.size)?.n ?? 0,
      ),
    })),
    {
      size: input.size,
      quantity: input.quantity,
      member: input.member,
      now: input.now,
    },
  );
  if (!line.ok) return err(line.error);
  const description = jersey
    ? `${line.value.description}, ${jersey.name}`
    : line.value.description;

  let orderId: MerchOrderId | null = null;
  const started = await startPurchase(db, {
    userId: input.userId,
    seasonId: null,
    items: [
      {
        kind: "merch",
        amountCents: line.value.amountCents,
        description,
        registrationId: null,
        teamSeasonId: jersey?.teamSeasonId ?? null,
      },
    ],
    promoCode: null,
    useCredit: input.useCredit,
    now: input.now,
    attach: async (purchaseId) => {
      const [created] = await db
        .insert(merchOrder)
        .values({
          itemId: item.id,
          userId: input.userId,
          purchaseId,
          status: "held",
          size: line.value.size,
          quantity: line.value.quantity,
          unitPriceCents: line.value.unitCents,
          teamSeasonId: jersey?.teamSeasonId ?? null,
          teamName: jersey?.name ?? null,
          colorHex: jersey?.colorHex ?? null,
          heldUntil: holdUntil(input.now),
        })
        .returning({ id: merchOrder.id });
      orderId = created?.id ?? null;
    },
  });
  // An order takes no promo code, so starting it can't fail.
  if (!started.ok) throw new Error(`Merch checkout failed: ${started.error}`);
  if (!orderId) throw new Error("The order was not placed");
  if (started.value.totalCents === 0) return ok({ kind: "paid", orderId });
  return ok({
    kind: "checkout",
    orderId,
    purchaseId: started.value.purchaseId,
    totalCents: started.value.totalCents,
    creditCents: started.value.creditCents,
    description,
    expiresAt: checkoutExpiry(input.now),
  });
}

/**
 * Locks the items whose stock these purchases' orders hold, before the
 * purchases themselves change, in the same order a buyer takes locks.
 */
export async function lockMerchItems(
  db: Db,
  purchaseIds: readonly PurchaseId[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  const items = db
    .select({ id: merchOrder.itemId })
    .from(merchOrder)
    .where(inArray(merchOrder.purchaseId, [...purchaseIds]));
  await db
    .select({ id: merchItem.id })
    .from(merchItem)
    .where(inArray(merchItem.id, items))
    .orderBy(asc(merchItem.id))
    .for("update");
}

/** A checkout ended unpaid: its stock is free again. Safe to call twice. */
export async function releaseMerchHolds(
  db: Db,
  purchaseIds: readonly PurchaseId[],
): Promise<void> {
  if (purchaseIds.length === 0) return;
  await db
    .update(merchOrder)
    .set({ status: "released", heldUntil: null })
    .where(
      and(
        inArray(merchOrder.purchaseId, [...purchaseIds]),
        eq(merchOrder.status, "held"),
      ),
    );
}

function merchMessage(
  userId: UserId,
  payload: MerchPayload,
  dedupeKey: string,
): OutboxMessage {
  return {
    userId,
    topic: "payment",
    template: payload.kind === "receipt" ? "merch_receipt" : "merch_update",
    payload,
    dedupeKey,
  };
}

/**
 * An order's checkout was paid (or cost nothing): the order is in, and the
 * buyer gets a receipt. Called when the purchase settles. A checkout paid
 * after its hold ran out is still honored: the person paid.
 */
export async function settleMerch(
  db: Db,
  purchaseId: PurchaseId,
): Promise<void> {
  const paid = await db
    .update(merchOrder)
    .set({ status: "paid", heldUntil: null })
    .where(
      and(
        eq(merchOrder.purchaseId, purchaseId),
        inArray(merchOrder.status, ["held", "released"]),
      ),
    )
    .returning({
      id: merchOrder.id,
      userId: merchOrder.userId,
      teamName: merchOrder.teamName,
    });
  if (paid.length === 0) return;
  const [bought] = await db
    .select({
      totalCents: purchase.totalCents,
      creditCents: purchase.creditAppliedCents,
    })
    .from(purchase)
    .where(eq(purchase.id, purchaseId));
  const descriptions = await purchaseDescriptions(db, [purchaseId]);
  await enqueueMessages(
    db,
    paid.map((o) =>
      merchMessage(
        o.userId,
        {
          kind: "receipt",
          description: descriptions.get(purchaseId) ?? "Your order",
          ...(o.teamName ? { team: o.teamName } : {}),
          paid: moneyLine(
            bought?.totalCents ?? 0,
            bought?.creditCents ?? 0,
            "on your card",
            "of league credit",
          ),
        },
        `merch_receipt/${o.id}`,
      ),
    ),
  );
}

export type MyMerchOrder = {
  id: MerchOrderId;
  itemName: string;
  description: string;
  status: "held" | "paid" | "fulfilled" | "refunded";
  totalCents: number;
  creditCents: number;
  createdAt: Date;
  fulfilledAt: Date | null;
  heldUntil: Date | null;
};

/** A player's orders, newest first, without checkouts that ended unpaid. */
export async function myMerchOrders(
  db: Db,
  userId: UserId,
  now: Date,
): Promise<MyMerchOrder[]> {
  const rows = await db
    .select({
      id: merchOrder.id,
      itemName: merchItem.name,
      status: merchOrder.status,
      heldUntil: merchOrder.heldUntil,
      totalCents: purchase.totalCents,
      creditCents: purchase.creditAppliedCents,
      description: purchaseItem.description,
      createdAt: merchOrder.createdAt,
      fulfilledAt: merchOrder.fulfilledAt,
    })
    .from(merchOrder)
    .innerJoin(merchItem, eq(merchItem.id, merchOrder.itemId))
    .innerJoin(purchase, eq(purchase.id, merchOrder.purchaseId))
    .innerJoin(
      purchaseItem,
      and(
        eq(purchaseItem.purchaseId, purchase.id),
        eq(purchaseItem.kind, "merch"),
      ),
    )
    .where(
      and(
        eq(merchOrder.userId, userId),
        ne(merchOrder.status, "released"),
        or(ne(merchOrder.status, "held"), gt(merchOrder.heldUntil, now)),
      ),
    )
    .orderBy(desc(merchOrder.createdAt))
    .limit(50);
  return rows.flatMap((r) =>
    r.status === "released" ? [] : [{ ...r, status: r.status }],
  );
}

export type AdminOrder = {
  id: MerchOrderId;
  itemId: MerchItemId;
  itemName: string;
  name: string;
  email: string;
  size: MerchSize;
  quantity: number;
  teamName: string | null;
  colorHex: string | null;
  status: "paid" | "fulfilled" | "refunded";
  unitPriceCents: number;
  creditCents: number;
  cardCents: number;
  refundedCents: number;
  paymentId: PaymentId | null;
  createdAt: Date;
  fulfilledAt: Date | null;
};

/**
 * Paid, fulfilled and refunded orders, by item and then size and team, for
 * the admin's lists and the printer's CSV. One query; `itemId` narrows it
 * to one item and `statuses` to the orders still to make.
 */
export async function merchOrders(
  db: Db,
  leagueId: LeagueId,
  options: {
    itemId?: MerchItemId;
    statuses?: readonly ("paid" | "fulfilled" | "refunded")[];
  } = {},
): Promise<AdminOrder[]> {
  const rows = await db
    .select({
      id: merchOrder.id,
      itemId: merchOrder.itemId,
      itemName: merchItem.name,
      first: profile.firstName,
      last: profile.lastName,
      account: user.name,
      email: user.email,
      size: merchOrder.size,
      quantity: merchOrder.quantity,
      teamName: merchOrder.teamName,
      colorHex: merchOrder.colorHex,
      status: merchOrder.status,
      unitPriceCents: merchOrder.unitPriceCents,
      creditCents: purchase.creditAppliedCents,
      paymentId: payment.id,
      cardCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      createdAt: merchOrder.createdAt,
      fulfilledAt: merchOrder.fulfilledAt,
    })
    .from(merchOrder)
    .innerJoin(merchItem, eq(merchItem.id, merchOrder.itemId))
    .innerJoin(user, eq(user.id, merchOrder.userId))
    .leftJoin(profile, eq(profile.userId, merchOrder.userId))
    .innerJoin(purchase, eq(purchase.id, merchOrder.purchaseId))
    .leftJoin(
      payment,
      and(eq(payment.purchaseId, purchase.id), eq(payment.status, "succeeded")),
    )
    .where(
      and(
        eq(merchItem.leagueId, leagueId),
        options.itemId ? eq(merchOrder.itemId, options.itemId) : undefined,
        inArray(
          merchOrder.status,
          options.statuses
            ? [...options.statuses]
            : ["paid", "fulfilled", "refunded"],
        ),
      ),
    )
    .orderBy(
      asc(merchItem.name),
      asc(merchOrder.size),
      asc(merchOrder.teamName),
      asc(merchOrder.createdAt),
      asc(merchOrder.id),
    );
  return rows.flatMap((r) =>
    r.status === "held" || r.status === "released"
      ? []
      : [
          {
            id: r.id,
            itemId: r.itemId,
            itemName: r.itemName,
            name: [r.first, r.last].filter(Boolean).join(" ") || r.account,
            email: r.email,
            size: r.size,
            quantity: r.quantity,
            teamName: r.teamName,
            colorHex: r.colorHex,
            status: r.status,
            unitPriceCents: r.unitPriceCents,
            creditCents: r.creditCents,
            cardCents: r.cardCents ?? 0,
            refundedCents: r.refundedCents ?? 0,
            paymentId: r.paymentId,
            createdAt: r.createdAt,
            fulfilledAt: r.fulfilledAt,
          },
        ],
  );
}

/** The printer's CSV: what to make, in what size and color, for whom. */
export const PRINTER_COLUMNS: readonly Column<AdminOrder>[] = [
  { header: "Item", value: (o) => o.itemName },
  { header: "Size", value: (o) => merchSizeLabel(o.size) },
  { header: "Quantity", value: (o) => o.quantity },
  { header: "Team", value: (o) => o.teamName },
  { header: "Team color", value: (o) => o.colorHex },
  { header: "Name", value: (o) => o.name },
  { header: "Email", value: (o) => o.email },
  { header: "Paid each", value: (o) => centsToAmount(o.unitPriceCents) },
  { header: "Ordered at", value: (o) => o.createdAt },
  { header: "Order", value: (o) => o.id },
];

/** A download of the printer's CSV, in the audit log. */
export async function recordMerchExport(
  db: Db,
  input: { actorId: UserId; leagueId: LeagueId; rows: number },
): Promise<void> {
  await recordAudit(db, {
    actorId: input.actorId,
    action: "merch.export",
    entityType: "league",
    entityId: input.leagueId,
    after: { rows: input.rows },
  });
}

/**
 * Marks paid orders of an item fulfilled (handed out or shipped), with an
 * audit row and a notice to each buyer. Orders already fulfilled or
 * refunded are left alone, so pressing twice changes nothing. Returns how
 * many changed.
 */
export async function fulfillMerchOrders(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    /** These orders, or every paid order of the item when null. */
    orderIds: readonly MerchOrderId[] | null;
    actorId: UserId;
    now: Date;
  },
): Promise<Result<number, "not_found">> {
  const item = await lockItem(db, input.itemId);
  if (!item || item.leagueId !== input.leagueId) return err("not_found");
  if (input.orderIds !== null && input.orderIds.length === 0) return ok(0);
  const done = await db
    .update(merchOrder)
    .set({
      status: "fulfilled",
      fulfilledAt: input.now,
      fulfilledBy: input.actorId,
    })
    .where(
      and(
        eq(merchOrder.itemId, input.itemId),
        eq(merchOrder.status, "paid"),
        input.orderIds
          ? inArray(merchOrder.id, [...input.orderIds])
          : undefined,
      ),
    )
    .returning({
      id: merchOrder.id,
      userId: merchOrder.userId,
      teamName: merchOrder.teamName,
      purchaseId: merchOrder.purchaseId,
    });
  if (done.length === 0) return ok(0);
  const descriptions = await purchaseDescriptions(
    db,
    done.map((d) => d.purchaseId),
  );
  for (const d of done)
    await recordAudit(db, {
      actorId: input.actorId,
      action: "merch.order_fulfill",
      entityType: "merch_order",
      entityId: d.id,
      before: { status: "paid" },
      after: { status: "fulfilled" },
    });
  await enqueueMessages(
    db,
    done.map((d) =>
      merchMessage(
        d.userId,
        {
          kind: "fulfilled",
          description: descriptions.get(d.purchaseId) ?? item.name,
          ...(d.teamName ? { team: d.teamName } : {}),
        },
        `merch_fulfilled/${d.id}`,
      ),
    ),
  );
  return ok(done.length);
}

/** What each merch purchase bought, as its line reads. */
async function purchaseDescriptions(
  db: Db,
  purchaseIds: readonly PurchaseId[],
): Promise<Map<PurchaseId, string>> {
  if (purchaseIds.length === 0) return new Map();
  const rows = await db
    .select({
      purchaseId: purchaseItem.purchaseId,
      description: purchaseItem.description,
    })
    .from(purchaseItem)
    .where(
      and(
        inArray(purchaseItem.purchaseId, [...purchaseIds]),
        eq(purchaseItem.kind, "merch"),
      ),
    );
  return new Map(rows.map((r) => [r.purchaseId, r.description]));
}

/**
 * Ends a paid or fulfilled order the league refunded: its stock counts as
 * free again, credit spent on it goes back, and the buyer is told. Only
 * such an order changes, so calling it twice changes nothing. Call it with
 * the item locked.
 */
async function endOrder(
  db: Db,
  orderId: MerchOrderId,
  cardCents: number,
): Promise<{ ended: boolean; creditCents: number }> {
  const [ended] = await db
    .update(merchOrder)
    .set({ status: "refunded" })
    .where(
      and(
        eq(merchOrder.id, orderId),
        inArray(merchOrder.status, ["paid", "fulfilled"]),
      ),
    )
    .returning({
      id: merchOrder.id,
      userId: merchOrder.userId,
      purchaseId: merchOrder.purchaseId,
      teamName: merchOrder.teamName,
    });
  if (!ended) return { ended: false, creditCents: 0 };
  const creditCents = await returnSpentCredit(db, ended.purchaseId);
  const descriptions = await purchaseDescriptions(db, [ended.purchaseId]);
  await enqueueMessages(db, [
    merchMessage(
      ended.userId,
      {
        kind: "refunded",
        description: descriptions.get(ended.purchaseId) ?? "Your order",
        ...(ended.teamName ? { team: ended.teamName } : {}),
        returned: moneyLine(
          cardCents,
          creditCents,
          "back to your card",
          "back to your league credit",
        ),
      },
      `merch_refund/${ended.id}`,
    ),
  ]);
  return { ended: true, creditCents };
}

/**
 * After a charge.refunded webhook: if every cent of an order's payment
 * went back, here or in Stripe's dashboard, the order ends.
 */
export async function endRefundedMerch(
  db: Db,
  purchaseId: PurchaseId,
): Promise<void> {
  const rows = await db
    .select({ id: merchOrder.id, refundedCents: payment.refundedCents })
    .from(merchOrder)
    .innerJoin(purchase, eq(purchase.id, merchOrder.purchaseId))
    .innerJoin(payment, eq(payment.purchaseId, purchase.id))
    .where(
      and(
        eq(merchOrder.purchaseId, purchaseId),
        inArray(merchOrder.status, ["paid", "fulfilled"]),
        eq(purchase.status, "refunded"),
      ),
    );
  for (const o of rows) await endOrder(db, o.id, o.refundedCents);
}

export type MerchRefundError =
  "not_found" | "not_paid" | Exclude<RefundStartError, "unknown_payment">;

export type StartedMerchRefund =
  /** The card part goes back through Stripe; finish once it accepts. */
  | {
      kind: "stripe";
      refundId: RefundId;
      paymentIntentId: string;
      amountCents: number;
    }
  /** Nothing was on a card (credit or a free member price): done. */
  | { kind: "done"; creditCents: number };

/**
 * An admin refunds an order in full through the refund flow: the card part
 * is reserved as a refund, and the order ends once Stripe accepts it
 * (finishMerchRefund). An order paid only with credit ends at once, with
 * the credit back. Run it in a transaction.
 */
export async function startMerchRefund(
  db: Db,
  input: {
    leagueId: LeagueId;
    itemId: MerchItemId;
    orderId: MerchOrderId;
    reason: string;
    actorId: UserId;
  },
): Promise<Result<StartedMerchRefund, MerchRefundError>> {
  const item = await lockItem(db, input.itemId);
  if (!item || item.leagueId !== input.leagueId) return err("not_found");
  const [o] = await db
    .select({ status: merchOrder.status, paymentId: payment.id })
    .from(merchOrder)
    .leftJoin(
      payment,
      and(
        eq(payment.purchaseId, merchOrder.purchaseId),
        eq(payment.status, "succeeded"),
      ),
    )
    .where(
      and(
        eq(merchOrder.id, input.orderId),
        eq(merchOrder.itemId, input.itemId),
      ),
    );
  if (!o) return err("not_found");
  if (o.status !== "paid" && o.status !== "fulfilled") return err("not_paid");
  const audit = () =>
    recordAudit(db, {
      actorId: input.actorId,
      action: "merch.order_refund",
      entityType: "merch_order",
      entityId: input.orderId,
      before: { status: o.status },
      after: { reason: input.reason || null },
    });
  if (o.paymentId) {
    const started = await startRefund(db, {
      merchOrderId: input.orderId,
      paymentId: o.paymentId,
      // Blank is everything that is left.
      amount: "",
      reason: input.reason,
      actorId: input.actorId,
    });
    if (!started.ok)
      return started.error === "unknown_payment"
        ? err("not_found")
        : err(started.error);
    if (started.value.kind === "stripe") {
      await audit();
      return ok({
        kind: "stripe",
        refundId: started.value.refundId,
        paymentIntentId: started.value.paymentIntentId,
        amountCents: started.value.amountCents,
      });
    }
  }
  const ended = await endOrder(db, input.orderId, 0);
  await audit();
  return ok({ kind: "done", creditCents: ended.creditCents });
}

/**
 * Stripe accepted an order's refund: record it as the refund flow does,
 * then end the order and give back its credit. The charge.refunded webhook
 * may get there first; either way the order ends once.
 */
export async function finishMerchRefund(
  db: Db,
  input: {
    itemId: MerchItemId;
    orderId: MerchOrderId;
    refundId: RefundId;
    stripeRefundId: string;
    amountCents: number;
    actorId: UserId;
  },
): Promise<void> {
  await lockItem(db, input.itemId);
  await confirmStripeRefund(db, {
    refundId: input.refundId,
    stripeRefundId: input.stripeRefundId,
    actorId: input.actorId,
  });
  await endOrder(db, input.orderId, input.amountCents);
}

/** An order's checkout session, to send someone back to it. */
export async function merchCheckout(db: Db, purchaseId: PurchaseId) {
  const [found] = await db
    .select({
      sessionId: purchase.stripeCheckoutSessionId,
      status: purchase.status,
    })
    .from(purchase)
    .where(eq(purchase.id, purchaseId));
  return found ?? null;
}

/**
 * Open merch checkouts a person still holds, so deleting their account
 * can give the stock back.
 */
export async function heldMerchPurchases(
  db: Db,
  userId: UserId,
): Promise<PurchaseId[]> {
  const rows = await db
    .select({ id: merchOrder.purchaseId })
    .from(merchOrder)
    .where(and(eq(merchOrder.userId, userId), eq(merchOrder.status, "held")));
  return rows.map((r) => r.id);
}
