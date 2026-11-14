import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { catalog, merchOrders, photoBytesUsed } from "@/db/queries/merch";
import { currentLeague } from "@/db/queries/seasons";
import {
  MERCH_PHOTO_CAP_BYTES,
  orderWindow,
  priceLine,
} from "@/domain/merch/catalog";
import { requirePermission } from "@/lib/auth/permission";
import { PageLoading } from "@/components/page-loading";

export const metadata: Metadata = { title: "Merch" };

const PAGE = "/app/admin/merch";

export default function MerchAdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <MerchAdmin />
      </Suspense>
    </main>
  );
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

async function MerchAdmin() {
  await requirePermission("merch.manage", { next: PAGE });
  const lg = await currentLeague(db);
  const now = new Date();
  const [items, toMake, used] = await Promise.all([
    lg ? catalog(db, lg.id, now, { hidden: true }) : [],
    lg ? merchOrders(db, lg.id, { statuses: ["paid"] }) : [],
    photoBytesUsed(db),
  ]);
  const openByItem = new Map<string, number>();
  for (const o of toMake)
    openByItem.set(o.itemId, (openByItem.get(o.itemId) ?? 0) + o.quantity);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-small">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center underline"
        >
          League admin
        </Link>
      </nav>
      <header className="flex flex-col gap-3">
        <h1 className="text-h1">Merch</h1>
        <p className="text-text-muted">
          The league shop: league gear and replacement team jerseys, paid
          through Stripe or with league credit.
        </p>
        <p className="flex flex-wrap gap-3">
          <Link href={`${PAGE}/new`} className="btn btn-primary">
            New item
          </Link>
          <a href={`${PAGE}/orders.csv`} className="btn btn-secondary">
            Download orders to make (CSV)
          </a>
        </p>
      </header>

      <section aria-labelledby="items" className="flex flex-col gap-3">
        <h2 id="items" className="text-h2">
          Items
        </h2>
        {items.length === 0 ? (
          <p className="text-text-muted">No items yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const window = orderWindow(item, now);
              const open = openByItem.get(item.id) ?? 0;
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-card border border-border bg-surface p-3"
                >
                  <Link
                    href={`${PAGE}/${item.id}`}
                    className="font-bold underline"
                  >
                    {item.name}
                  </Link>
                  <span className="text-small text-text-muted">
                    {priceLine(item)} ·{" "}
                    {window === "hidden"
                      ? "Hidden"
                      : window === "closed"
                        ? "Orders closed"
                        : "In the shop"}{" "}
                    · {open} to make
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-small text-text-muted">
        Photos use {mb(used)} MB of {mb(MERCH_PHOTO_CAP_BYTES)} MB.
      </p>
    </>
  );
}
