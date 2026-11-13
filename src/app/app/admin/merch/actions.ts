"use server";

import { notFound, redirect } from "next/navigation";
import { db, txDb } from "@/db/client";
import {
  addMerchPhoto,
  createMerchItem,
  finishMerchRefund,
  fulfillMerchOrders,
  removeMerchPhoto,
  setItemHidden,
  startMerchRefund,
  updateMerchItem,
} from "@/db/queries/merch";
import { dropRefund } from "@/db/queries/refunds";
import { currentLeague } from "@/db/queries/seasons";
import {
  type MerchImageId,
  type MerchItemId,
  type MerchOrderId,
  parseId,
} from "@/domain/ids";
import {
  checkUpload,
  type ItemForm,
  type MerchSize,
  parseItemForm,
} from "@/domain/merch/catalog";
import { isFreshSession } from "@/lib/auth/config";
import {
  requirePermissionToChange,
  sessionSignedInAt,
} from "@/lib/auth/permission";
import { compressPhoto } from "@/lib/social/compress-photo";
import { sendQueuedSoon } from "@/services/outbox";
import { stripeClient } from "@/services/stripe";

const LIST = "/app/admin/merch";
const pageFor = (itemId: string) => `${LIST}/${itemId}`;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

function itemForm(form: FormData): ItemForm {
  const size = (name: MerchSize) => ({
    offered: form.get(`size_${name}`) === "on",
    stock: text(form, `stock_${name}`),
  });
  return {
    kind: text(form, "kind"),
    name: text(form, "name"),
    description: text(form, "description"),
    price: text(form, "price"),
    memberPrice: text(form, "memberPrice"),
    madeToOrder: form.get("madeToOrder") === "on",
    deadline: text(form, "deadline"),
    sizes: {
      xs: size("xs"),
      s: size("s"),
      m: size("m"),
      l: size("l"),
      xl: size("xl"),
      xxl: size("xxl"),
      one_size: size("one_size"),
    },
  };
}

async function adminFor(next: string) {
  const subject = await requirePermissionToChange("merch.manage", { next });
  const lg = await currentLeague(db);
  if (!lg) notFound();
  return { subject, lg };
}

/** Adds an item to the shop's catalog (merch.manage). */
export async function createItemAction(form: FormData): Promise<void> {
  const page = `${LIST}/new`;
  const { subject, lg } = await adminFor(page);
  const parsed = parseItemForm(itemForm(form), lg.timeZone);
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}`);
  const id = await txDb.transaction((tx) =>
    createMerchItem(tx, {
      leagueId: lg.id,
      values: parsed.value,
      actorId: subject.userId,
    }),
  );
  redirect(`${pageFor(id)}?saved=created`);
}

/** Changes an item's details, price, sizes and stock (merch.manage). */
export async function updateItemAction(
  rawItemId: string,
  form: FormData,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  if (!itemId) notFound();
  const page = pageFor(itemId);
  const { subject, lg } = await adminFor(page);
  const parsed = parseItemForm(itemForm(form), lg.timeZone);
  if (!parsed.ok) redirect(`${page}?error=${parsed.error}#details`);
  const result = await txDb.transaction((tx) =>
    updateMerchItem(tx, {
      leagueId: lg.id,
      itemId,
      values: parsed.value,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) notFound();
  redirect(`${page}?saved=updated`);
}

/** Takes an item out of the shop, or puts it back (merch.manage). */
export async function setHiddenAction(
  rawItemId: string,
  hidden: boolean,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  if (!itemId) notFound();
  const page = pageFor(itemId);
  const { subject, lg } = await adminFor(page);
  const result = await txDb.transaction((tx) =>
    setItemHidden(tx, {
      leagueId: lg.id,
      itemId,
      hidden,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) notFound();
  redirect(`${page}?saved=${hidden ? "hidden" : "shown"}`);
}

/**
 * Stores a photo of an item (merch.manage): checked, shrunk to one WebP
 * with its metadata dropped, and kept under the merch photo cap.
 */
export async function addPhotoAction(
  rawItemId: string,
  form: FormData,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  if (!itemId) notFound();
  const page = pageFor(itemId);
  const { subject, lg } = await adminFor(page);
  const file = form.get("photo");
  if (!(file instanceof File)) redirect(`${page}?error=not_image#photos`);
  const checked = checkUpload(file, 0);
  if (!checked.ok) redirect(`${page}?error=${checked.error}#photos`);
  const stored = await compressPhoto(Buffer.from(await file.arrayBuffer()));
  if (!stored) redirect(`${page}?error=not_image#photos`);
  const result = await txDb.transaction((tx) =>
    addMerchPhoto(tx, {
      leagueId: lg.id,
      itemId,
      bytes: stored.bytes,
      alt: text(form, "alt"),
      actorId: subject.userId,
    }),
  );
  if (!result.ok) {
    if (result.error === "not_found") notFound();
    redirect(`${page}?error=${result.error}#photos`);
  }
  redirect(`${page}?saved=photo#photos`);
}

export async function removePhotoAction(
  rawItemId: string,
  rawImageId: string,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  const imageId = parseId<MerchImageId>(rawImageId);
  if (!itemId || !imageId) notFound();
  const page = pageFor(itemId);
  const { subject, lg } = await adminFor(page);
  const result = await txDb.transaction((tx) =>
    removeMerchPhoto(tx, {
      leagueId: lg.id,
      itemId,
      imageId,
      actorId: subject.userId,
    }),
  );
  if (!result.ok) notFound();
  redirect(`${page}?saved=photo_removed#photos`);
}

/**
 * Marks one paid order fulfilled, or every paid order of the item when no
 * order is named (merch.manage). Each buyer gets a notice.
 */
export async function fulfillAction(
  rawItemId: string,
  rawOrderId: string | null,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  if (!itemId) notFound();
  const orderId =
    rawOrderId === null ? null : parseId<MerchOrderId>(rawOrderId);
  if (rawOrderId !== null && !orderId) notFound();
  const page = pageFor(itemId);
  const { subject, lg } = await adminFor(page);
  const result = await txDb.transaction((tx) =>
    fulfillMerchOrders(tx, {
      leagueId: lg.id,
      itemId,
      orderIds: orderId ? [orderId] : null,
      actorId: subject.userId,
      now: new Date(),
    }),
  );
  if (!result.ok) notFound();
  sendQueuedSoon();
  redirect(`${page}?fulfilled=${result.value}#orders`);
}

/**
 * Refunds an order in full (refund.issue) through the refund flow: the
 * card part goes back through Stripe, the credit part back to the buyer's
 * balance, and the stock is free again. Like other refunds, it needs a
 * sign-in from the last 15 minutes.
 */
export async function refundOrderAction(
  rawItemId: string,
  rawOrderId: string,
  form: FormData,
): Promise<void> {
  const itemId = parseId<MerchItemId>(rawItemId);
  const orderId = parseId<MerchOrderId>(rawOrderId);
  if (!itemId || !orderId) notFound();
  const page = pageFor(itemId);
  const subject = await requirePermissionToChange("refund.issue", {
    next: page,
  });
  const lg = await currentLeague(db);
  if (!lg) notFound();
  if (form.get("confirm") !== "yes") redirect(`${page}?error=confirm#orders`);
  const signedInAt = await sessionSignedInAt();
  if (!signedInAt || !isFreshSession(signedInAt, new Date()))
    redirect(`${page}?error=stale#orders`);
  const started = await txDb.transaction((tx) =>
    startMerchRefund(tx, {
      leagueId: lg.id,
      itemId,
      orderId,
      reason: text(form, "reason").trim().slice(0, 200),
      actorId: subject.userId,
    }),
  );
  if (!started.ok) redirect(`${page}?error=${started.error}#orders`);
  const refund = started.value;
  if (refund.kind === "stripe") {
    const stripe = stripeClient();
    const sent = stripe
      ? await stripe.refunds
          .create(
            {
              payment_intent: refund.paymentIntentId,
              amount: refund.amountCents,
              metadata: { refundId: refund.refundId, merchOrderId: orderId },
            },
            { idempotencyKey: `refund-${refund.refundId}` },
          )
          .catch((error: unknown) => {
            console.error("Stripe refund failed", refund.refundId, error);
            return null;
          })
      : null;
    if (!sent) {
      await dropRefund(db, refund.refundId);
      redirect(
        `${page}?error=${stripe ? "refund_failed" : "payments_off"}#orders`,
      );
    }
    await txDb.transaction((tx) =>
      finishMerchRefund(tx, {
        itemId,
        orderId,
        refundId: refund.refundId,
        stripeRefundId: sent.id,
        amountCents: refund.amountCents,
        actorId: subject.userId,
      }),
    );
  }
  sendQueuedSoon();
  redirect(`${page}?saved=refunded#orders`);
}
