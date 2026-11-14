import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MerchPhoto } from "@/components/merch-photo";
import { db } from "@/db/client";
import { type AdminOrder, catalogItem, merchOrders } from "@/db/queries/merch";
import { currentLeague } from "@/db/queries/seasons";
import { type MerchItemId, parseId } from "@/domain/ids";
import {
  MAX_PHOTOS_PER_ITEM,
  merchSizeLabel,
  type MerchSize,
  PHOTO_ERRORS,
  priceLine,
} from "@/domain/merch/catalog";
import { formatCents } from "@/domain/registration/pricing";
import { localDate } from "@/domain/scheduler/slots";
import { requirePermission } from "@/lib/auth/permission";
import {
  addPhotoAction,
  fulfillAction,
  refundOrderAction,
  removePhotoAction,
  setHiddenAction,
  updateItemAction,
} from "../actions";
import { ItemFormFields } from "../item-form";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Merch item" };

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

const SAVED: Record<string, string> = {
  created: "Item added. It's in the shop now.",
  updated: "Item saved.",
  hidden: "Item hidden from the shop. Its orders stay here.",
  shown: "Item is back in the shop.",
  photo: "Photo added.",
  photo_removed: "Photo removed.",
  refunded: "Order refunded. The buyer gets an email.",
};

const ERRORS: Record<string, string> = {
  ...PHOTO_ERRORS,
  confirm: "Tick the box to confirm the refund.",
  stale: "For your security, sign in again before refunding.",
  not_paid: "That order isn't paid, so there is nothing to refund.",
  refund_failed: "Stripe didn't accept the refund. Nothing changed; try again.",
  payments_off: "Online payment isn't set up, so Stripe can't refund.",
  over_refund: "That's more than is left to refund.",
};

/** What a buyer paid: "$15 card + $5 credit", "$20 credit" or "Free". */
function paidLine(o: AdminOrder): string {
  const parts = [
    ...(o.cardCents > 0 ? [`${formatCents(o.cardCents)} card`] : []),
    ...(o.creditCents > 0 ? [`${formatCents(o.creditCents)} credit`] : []),
  ];
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

export default function MerchItemAdminPage(
  props: PageProps<"/app/admin/merch/[item]">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <MerchItemAdmin {...props} />
      </Suspense>
    </main>
  );
}

async function MerchItemAdmin({
  params,
  searchParams,
}: PageProps<"/app/admin/merch/[item]">) {
  const { item: raw } = await params;
  const itemId = parseId<MerchItemId>(raw);
  if (!itemId) notFound();
  const page = `/app/admin/merch/${itemId}`;
  await requirePermission("merch.manage", { next: page });
  const query = await searchParams;
  const lg = await currentLeague(db);
  if (!lg) notFound();
  const now = new Date();
  const [item, orders] = await Promise.all([
    catalogItem(db, lg.id, itemId, now, { hidden: true }),
    merchOrders(db, lg.id, { itemId }),
  ]);
  if (!item) notFound();
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : null;
  const errorCode = typeof query.error === "string" ? query.error : null;
  const error = errorCode ? (ERRORS[errorCode] ?? null) : null;
  const fulfilled =
    typeof query.fulfilled === "string" ? Number(query.fulfilled) : null;
  const toMake = orders.filter((o) => o.status === "paid");
  const done = orders.filter((o) => o.status === "fulfilled");
  const refunded = orders.filter((o) => o.status === "refunded");
  const bySize = new Map<MerchSize, number>();
  for (const o of toMake)
    bySize.set(o.size, (bySize.get(o.size) ?? 0) + o.quantity);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href="/app/admin/merch"
          className="inline-flex min-h-11 items-center underline"
        >
          Merch
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{item.name}</h1>
        <p>
          {priceLine(item)} ·{" "}
          {item.hiddenAt ? "Hidden from the shop" : "In the shop"}
        </p>
        <form action={setHiddenAction.bind(null, item.id, !item.hiddenAt)}>
          <SubmitButton className="btn btn-secondary">
            {item.hiddenAt ? "Put back in the shop" : "Hide from the shop"}
          </SubmitButton>
        </form>
      </header>

      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          {saved}
        </p>
      )}
      {fulfilled !== null && Number.isInteger(fulfilled) && (
        <p role="status" className="rounded-lg border border-success p-3">
          {fulfilled === 1
            ? "1 order marked fulfilled. The buyer gets a note."
            : `${fulfilled} orders marked fulfilled. Each buyer gets a note.`}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <section
        id="orders"
        aria-labelledby="orders-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="orders-heading" className="text-h2">
          Orders to make ({toMake.reduce((n, o) => n + o.quantity, 0)})
        </h2>
        {bySize.size > 0 && (
          <p>
            {[...bySize.entries()]
              .map(([size, n]) => `${merchSizeLabel(size)}: ${n}`)
              .join(" · ")}
          </p>
        )}
        {toMake.length === 0 ? (
          <p className="text-text-muted">Nothing waiting.</p>
        ) : (
          <>
            <form action={fulfillAction.bind(null, item.id, null)}>
              <SubmitButton className="btn btn-primary">
                Mark all {toMake.length} fulfilled
              </SubmitButton>
            </form>
            <ul className="flex flex-col gap-3">
              {toMake.map((o) => (
                <OrderRow key={o.id} itemId={item.id} order={o} />
              ))}
            </ul>
          </>
        )}
        {done.length > 0 && (
          <>
            <h3 className="text-h3">Fulfilled ({done.length})</h3>
            <ul className="flex flex-col gap-3">
              {done.map((o) => (
                <OrderRow key={o.id} itemId={item.id} order={o} />
              ))}
            </ul>
          </>
        )}
        {refunded.length > 0 && (
          <>
            <h3 className="text-h3">Refunded ({refunded.length})</h3>
            <ul className="flex flex-col gap-1">
              {refunded.map((o) => (
                <li key={o.id}>
                  {o.name}, {merchSizeLabel(o.size)} × {o.quantity}{" "}
                  <span className="text-small text-text-muted">
                    ({paidLine(o)}
                    {o.refundedCents > 0
                      ? `, ${formatCents(o.refundedCents)} back on the card`
                      : ""}
                    )
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section
        id="photos"
        aria-labelledby="photos-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="photos-heading" className="text-h2">
          Photos ({item.photos.length} of {MAX_PHOTOS_PER_ITEM})
        </h2>
        {item.photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {item.photos.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <MerchPhoto id={p.id} alt={p.alt} sizes="180px" admin />
                <form action={removePhotoAction.bind(null, item.id, p.id)}>
                  <SubmitButton className="inline-flex min-h-11 items-center text-small underline">
                    Remove<span className="sr-only"> photo: {p.alt}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        {item.photos.length < MAX_PHOTOS_PER_ITEM && (
          <form
            action={addPhotoAction.bind(null, item.id)}
            className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="photo" className="font-bold">
                Photo (JPEG, PNG or WebP, up to 3 MB)
              </label>
              <input
                id="photo"
                name="photo"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp"
                className="min-h-11"
              />
            </div>
            <div className="flex w-full flex-col gap-1">
              <label htmlFor="alt" className="font-bold">
                Describe the photo
              </label>
              <input
                id="alt"
                name="alt"
                required
                maxLength={200}
                className={`${control} w-full`}
              />
            </div>
            <SubmitButton className="btn btn-secondary">Add photo</SubmitButton>
            <p className="text-small text-text-muted">
              Stored small: shrunk to 1000 pixels wide, with location data
              removed.
            </p>
          </form>
        )}
      </section>

      <section
        id="details"
        aria-labelledby="details-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="details-heading" className="text-h2">
          Details
        </h2>
        <ItemFormFields
          action={updateItemAction.bind(null, item.id)}
          values={{
            ...item,
            priceCents: item.priceCents,
            deadline: item.orderDeadline
              ? localDate(item.orderDeadline, lg.timeZone)
              : "",
          }}
          error={errorCode}
          submit="Save item"
        />
      </section>
    </>
  );
}

function OrderRow({ itemId, order: o }: { itemId: string; order: AdminOrder }) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold">{o.name}</p>
        <p>
          {merchSizeLabel(o.size)} × {o.quantity}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-small text-text-muted">
        {o.teamName && (
          <>
            {o.colorHex && (
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full border border-border-strong"
                style={{ backgroundColor: o.colorHex }}
              />
            )}
            <span>
              {o.teamName}
              {o.colorHex ? ` (${o.colorHex})` : ""} ·
            </span>
          </>
        )}
        <span>{paidLine(o)}</span>
      </p>
      <div className="flex flex-wrap items-start gap-3">
        {o.status === "paid" && (
          <form action={fulfillAction.bind(null, itemId, o.id)}>
            <SubmitButton className="btn btn-secondary">
              Mark fulfilled
              <span className="sr-only"> for {o.name}</span>
            </SubmitButton>
          </form>
        )}
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
            Refund {o.name}
          </summary>
          <form
            action={refundOrderAction.bind(null, itemId, o.id)}
            className="mt-2 flex flex-col items-start gap-2"
          >
            <p className="text-small">
              Sends back {paidLine(o).toLowerCase()} in full and puts the stock
              back.
            </p>
            <label htmlFor={`reason-${o.id}`} className="text-small font-bold">
              Reason (optional)
            </label>
            <input
              id={`reason-${o.id}`}
              name="reason"
              maxLength={200}
              className={`${control} w-full`}
            />
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="size-5 accent-brand"
              />
              Yes, refund this order
            </label>
            <SubmitButton className="btn btn-secondary">
              Refund the order
            </SubmitButton>
          </form>
        </details>
      </div>
    </li>
  );
}
