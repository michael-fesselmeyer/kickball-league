import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MerchPhoto } from "@/components/merch-photo";
import { db } from "@/db/client";
import { catalog, type MyMerchOrder, myMerchOrders } from "@/db/queries/merch";
import { currentLeague } from "@/db/queries/seasons";
import { orderWindow, priceLine } from "@/domain/merch/catalog";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission } from "@/lib/auth/permission";
import { ConfirmingPayment } from "../seasons/[season]/confirming";

export const metadata: Metadata = { title: "League shop" };

export default function ShopPage(props: PageProps<"/app/shop">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<p className="min-h-svh">Loading the shop…</p>}>
        <Shop {...props} />
      </Suspense>
    </main>
  );
}

const STATUS: Record<MyMerchOrder["status"], string> = {
  held: "Checking out",
  paid: "Ordered",
  fulfilled: "Ready",
  refunded: "Refunded",
};

const day = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(at);

async function Shop({ searchParams }: PageProps<"/app/shop">) {
  const subject = await requirePermission("merch.order", { next: "/app/shop" });
  const query = await searchParams;
  const now = new Date();
  const lg = await currentLeague(db);
  const [items, orders] = await Promise.all([
    lg ? catalog(db, lg.id, now, { hidden: false }) : [],
    myMerchOrders(db, subject.userId, now),
  ]);
  const timeZone = lg?.timeZone ?? "America/New_York";
  const returned = typeof query.order === "string" ? query.order : null;
  const waiting = orders.some((o) => o.status === "held");

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">League shop</h1>
        <p className="text-text-muted">
          League gear and replacement team jerseys. Pick it up from the league
          at your next game.
        </p>
      </header>

      {returned === "paid" && waiting && <ConfirmingPayment />}
      {((returned === "paid" && !waiting) || returned === "placed") && (
        <p role="status" className="rounded-lg border border-success p-3">
          Thanks! Your order is in. We&apos;ll email you when it&apos;s ready.
        </p>
      )}

      {orders.length > 0 && (
        <section aria-labelledby="orders" className="flex flex-col gap-3">
          <h2 id="orders" className="text-h2">
            Your orders
          </h2>
          <ul className="flex flex-col gap-2">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-card border border-border bg-surface p-3"
              >
                <span className="font-bold">{o.description}</span>
                <span className="text-small text-text-muted">
                  {STATUS[o.status]}
                  {o.status === "fulfilled" && o.fulfilledAt
                    ? ` ${day(o.fulfilledAt, timeZone)}`
                    : ""}{" "}
                  · {formatCents(o.totalCents + o.creditCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="items" className="flex flex-col gap-4">
        <h2 id="items" className="text-h2">
          For sale
        </h2>
        {items.length === 0 ? (
          <p className="text-text-muted">Nothing for sale right now.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {items.map((item, i) => {
              const window = orderWindow(item, now);
              const soldOut = item.sizes.every((s) => s.left === 0);
              const photo = item.photos[0];
              return (
                <li key={item.id}>
                  <Link
                    href={`/app/shop/${item.id}`}
                    className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3"
                  >
                    {photo ? (
                      <MerchPhoto
                        id={photo.id}
                        alt={photo.alt}
                        sizes="(min-width: 768px) 280px, (min-width: 640px) 50vw, 100vw"
                        priority={i < 2}
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="hidden aspect-square rounded-card bg-surface-2 sm:block"
                      />
                    )}
                    <span className="text-h3 underline">{item.name}</span>
                    <span>{priceLine(item)}</span>
                    <span className="text-small text-text-muted">
                      {window === "closed"
                        ? "Orders are closed"
                        : soldOut
                          ? "Sold out"
                          : item.orderDeadline
                            ? `Order by ${day(item.orderDeadline, timeZone)}`
                            : item.kind === "team_jersey"
                              ? "In your team's color"
                              : item.madeToOrder
                                ? "Made to order"
                                : "In stock"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
