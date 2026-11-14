import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MerchPhoto } from "@/components/merch-photo";
import { db } from "@/db/client";
import { creditBalance } from "@/db/queries/credit";
import { viewerOf } from "@/db/queries/event-audience";
import { catalogItem, playerTeams, profileShirtSize } from "@/db/queries/merch";
import { currentLeague } from "@/db/queries/seasons";
import { can } from "@/domain/authz/permissions";
import { type MerchItemId, parseId } from "@/domain/ids";
import {
  jerseyDefaults,
  MAX_QUANTITY,
  merchSizeLabel,
  orderWindow,
  priceLine,
  unitPrice,
} from "@/domain/merch/catalog";
import { creditToApply, formatMoment } from "@/domain/money/credit";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { orderMerchAction } from "../actions";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Shop item" };

const ERRORS: Record<string, string> = {
  not_found: "That item is gone.",
  hidden: "That item isn't for sale any more.",
  closed: "Orders for this item are closed.",
  size: "Pick a size.",
  quantity: `Order from 1 to ${MAX_QUANTITY}.`,
  sold_out:
    "There aren't that many left in that size. Try fewer, or another size.",
  no_team: "Replacement jerseys are for players on a team this season.",
  team: "Pick one of your teams.",
  payments_off:
    "Online payment isn't set up yet, so the shop can't take orders right now.",
  checkout_failed:
    "We couldn't start the checkout. Nothing was charged; try again.",
  checkout_open: "Your checkout is still open. Try again in a moment.",
};

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

export default function ShopItemPage(props: PageProps<"/app/shop/[item]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the item…</PageLoading>}>
        <ShopItem {...props} />
      </Suspense>
    </main>
  );
}

async function ShopItem({
  params,
  searchParams,
}: PageProps<"/app/shop/[item]">) {
  const { item: raw } = await params;
  const query = await searchParams;
  const itemId = parseId<MerchItemId>(raw);
  if (!itemId) notFound();
  const subject = await requirePermission("merch.order", {
    next: `/app/shop/${itemId}`,
  });
  const lg = await currentLeague(db);
  if (!lg) notFound();
  const now = new Date();
  const [item, viewer, credit, teams, shirtSize] = await Promise.all([
    catalogItem(db, lg.id, itemId, now, { hidden: false }),
    viewerOf(db, lg.id, subject.userId, can(subject, "merch.manage", {})),
    creditBalance(db, subject.userId),
    playerTeams(db, subject.userId),
    profileShirtSize(db, subject.userId),
  ]);
  if (!item) notFound();
  const window = orderWindow(item, now);
  const jersey = item.kind === "team_jersey";
  const defaults = jerseyDefaults(
    jersey ? teams : [],
    shirtSize,
    item.sizes.filter((s) => s.left !== 0).map((s) => s.size),
  );
  const price = unitPrice(item, viewer.member);
  const creditCents = creditToApply(price, credit);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const cancelled = query.order === "cancelled";
  const available = item.sizes.filter((s) => s.left !== 0);
  const canOrder =
    window === "open" && available.length > 0 && (!jersey || teams.length > 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href="/app/shop"
          className="inline-flex min-h-11 items-center underline"
        >
          League shop
        </Link>
      </nav>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{item.name}</h1>
        <p className="text-body-lg">
          {priceLine(item)}
          {viewer.member && item.memberPriceCents !== null
            ? ". You pay the member price."
            : ""}
        </p>
        {item.orderDeadline && window === "open" && (
          <p className="text-text-muted">
            Order by {formatMoment(item.orderDeadline, lg.timeZone)}. We print
            the batch after that.
          </p>
        )}
      </header>

      {item.photos.length > 0 && (
        <ul
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          aria-label="Photos"
        >
          {item.photos.map((p, i) => (
            <li key={p.id} className={i === 0 ? "col-span-2" : undefined}>
              <MerchPhoto
                id={p.id}
                alt={p.alt}
                sizes={
                  i === 0
                    ? "(min-width: 768px) 360px, 100vw"
                    : "(min-width: 768px) 180px, 50vw"
                }
                priority={i === 0}
              />
            </li>
          ))}
        </ul>
      )}

      {item.description && (
        <p className="max-w-prose whitespace-pre-line">{item.description}</p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {cancelled && (
        <p role="status" className="rounded-lg border border-border p-3">
          Checkout cancelled. Nothing was charged.
        </p>
      )}

      <section
        aria-labelledby="order"
        className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-4"
      >
        <h2 id="order" className="text-h2">
          Order
        </h2>
        {window === "closed" ? (
          <p>{ERRORS.closed}</p>
        ) : jersey && teams.length === 0 ? (
          <p>{ERRORS.no_team}</p>
        ) : available.length === 0 ? (
          <p>Sold out in every size.</p>
        ) : null}
        {canOrder && (
          <form
            action={orderMerchAction.bind(null, item.id)}
            className="flex w-full flex-col items-start gap-4"
          >
            {jersey && (
              <div className="flex flex-col gap-1">
                <label htmlFor="team" className="font-bold">
                  Team
                </label>
                <select
                  id="team"
                  name="team"
                  defaultValue={defaults.team?.teamSeasonId}
                  className={control}
                >
                  {teams.map((t) => (
                    <option key={t.teamSeasonId} value={t.teamSeasonId}>
                      {t.name} ({t.seasonName})
                    </option>
                  ))}
                </select>
                <p className="text-small text-text-muted">
                  Made in your team&apos;s color.
                </p>
              </div>
            )}
            <fieldset className="flex flex-col gap-2">
              <legend className="font-bold">Size</legend>
              <div className="flex flex-wrap gap-2">
                {item.sizes.map((s) => (
                  <label
                    key={s.size}
                    className={`flex min-h-11 min-w-11 items-center gap-2 rounded-input border border-border-strong px-3 ${
                      s.left === 0 ? "text-text-muted line-through" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="size"
                      value={s.size}
                      required
                      disabled={s.left === 0}
                      defaultChecked={
                        defaults.size === s.size ||
                        (available.length === 1 && available[0] === s)
                      }
                      className="size-5 accent-brand"
                    />
                    {merchSizeLabel(s.size)}
                    {s.left !== null && s.left > 0 && s.left <= 3 && (
                      <span className="text-small text-text-muted">
                        ({s.left} left)
                      </span>
                    )}
                    {s.left === 0 && (
                      <span className="sr-only">(sold out)</span>
                    )}
                  </label>
                ))}
              </div>
              {shirtSize && jersey && defaults.size && (
                <p className="text-small text-text-muted">
                  Your profile says {merchSizeLabel(defaults.size)}.
                </p>
              )}
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor="quantity" className="font-bold">
                How many
              </label>
              <select
                id="quantity"
                name="quantity"
                defaultValue="1"
                className={`${control} w-24`}
              >
                {Array.from({ length: MAX_QUANTITY }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ),
                )}
              </select>
            </div>
            {creditCents > 0 && (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="useCredit"
                  defaultChecked
                  className="size-5 accent-brand"
                />
                Use my league credit ({formatCents(credit)} available)
              </label>
            )}
            <button type="submit" className="btn btn-primary">
              Order for {formatCents(price)} each
            </button>
            <p className="text-small text-text-muted">
              You pay securely with Stripe. What you pick is held while you
              check out.
            </p>
          </form>
        )}
      </section>
    </>
  );
}
