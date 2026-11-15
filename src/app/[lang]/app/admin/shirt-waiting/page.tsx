import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { lateShirtBoard } from "@/db/queries/shirt-late";
import {
  BATCH_MINIMUM,
  SPARE_ERRORS,
  type SpareError,
} from "@/domain/shirts/late";
import { SHIRT_SIZES, sizeLabel } from "@/domain/shirts/summary";
import { requirePermission } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import {
  batchOrderedAction,
  batchReceivedAction,
  handOutSpareAction,
  logSpareAction,
} from "./actions";
import { todayIn } from "./today";

export const metadata: Metadata = { title: "Late-joiner shirts" };

const PAGE = "/app/admin/shirt-waiting";

const NOTICES: Record<string, (n: number) => string> = {
  spare_logged: () => "Spares logged.",
  handed_out: () => "Spare handed out. The player's shirt is marked received.",
  batch_ordered: (n) => `${n} ${n === 1 ? "shirt" : "shirts"} marked ordered.`,
  batch_received: (n) =>
    `${n} ${n === 1 ? "shirt" : "shirts"} marked received.`,
};

const ERRORS: Record<string, string> = {
  ...SPARE_ERRORS,
  not_found: "That player isn't in this league.",
  has_shirt: "That player already has a shirt.",
  no_size: "That player has no shirt size on their profile.",
  none_in_stock: "No spares are left in that size.",
};

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

export default function ShirtWaitingPage(
  props: PageProps<"/app/admin/shirt-waiting">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading the list…</PageLoading>}>
        <ShirtWaiting {...props} />
      </Suspense>
    </main>
  );
}

async function ShirtWaiting({
  searchParams,
}: PageProps<"/app/admin/shirt-waiting">) {
  await requirePermission("shirts.manage", { next: PAGE });
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) return <p>No league.</p>;
  const { rows, stock, summary } = await lateShirtBoard(
    db,
    league.id,
    todayIn(league.timeZone),
  );
  const n = typeof query.n === "string" ? Number(query.n) || 0 : 0;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice]?.(n) : null;
  const error =
    typeof query.error === "string"
      ? (ERRORS[query.error as SpareError] ?? null)
      : null;
  const stockSizes = SHIRT_SIZES.filter((s) => (stock[s] ?? 0) > 0);
  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Late-joiner shirts</h1>
        <p className="text-text-muted">
          Players who joined a team after their season&apos;s shirt order was
          placed, across every team. A small reorder costs too much per shirt,
          so wait until enough have built up, and hand out spares first. Teams
          in their own shirts, free agents without a team and players with no
          size aren&apos;t on this list.
        </p>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}

      <section aria-labelledby="batch" className="flex flex-col gap-3">
        <h2 id="batch" className="text-h2">
          Batch reorder
        </h2>
        <p
          role="status"
          className={`rounded-lg border p-3 ${summary.batchReady ? "border-success" : "border-border"}`}
        >
          {summary.total === 0
            ? "Nobody is waiting for a shirt."
            : summary.batchReady
              ? `Ready: ${summary.toOrder} to order after spares, at least the ${BATCH_MINIMUM} a small reorder needs.`
              : `Not yet: ${summary.toOrder} to order after spares, and ${summary.stillNeeded} more before a reorder of ${BATCH_MINIMUM} is worth it.`}
        </p>
        {summary.total > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <caption className="sr-only">
                Players waiting for a shirt, by team and size
              </caption>
              <thead className="text-small text-text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-3">
                    Team
                  </th>
                  {SHIRT_SIZES.map((s) => (
                    <th key={s} scope="col" className="px-1 text-right">
                      {sizeLabel(s)}
                    </th>
                  ))}
                  <th scope="col" className="pl-2 text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.byTeam.map((t) => (
                  <tr key={t.teamName} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {t.teamName}
                    </th>
                    {SHIRT_SIZES.map((s) => (
                      <td key={s} className="px-1 text-right">
                        {t.bySize[s] ?? ""}
                      </td>
                    ))}
                    <td className="pl-2 text-right font-bold">{t.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-text font-bold">
                  <th scope="row" className="py-2 pr-3 text-left">
                    To order after spares
                  </th>
                  {SHIRT_SIZES.map((s) => (
                    <td key={s} className="px-1 text-right">
                      {summary.afterSpares[s] || ""}
                    </td>
                  ))}
                  <td className="pl-2 text-right">{summary.toOrder}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {summary.total > 0 && (
            <form action={batchOrderedAction}>
              <SubmitButton className="btn min-h-11 btn-primary">
                I placed the reorder: mark {summary.total} ordered
              </SubmitButton>
            </form>
          )}
          <form action={batchReceivedAction}>
            <SubmitButton className="btn min-h-11 btn-secondary">
              The reorder arrived: mark received
            </SubmitButton>
          </form>
        </div>
        <p className="text-small text-text-muted">
          Marking ordered covers everyone on the list, so hand out spares first.
          Marking received only touches shirts in a season whose own order has
          already arrived; the rest arrive with that order.
        </p>
      </section>

      <section
        id="spares"
        aria-labelledby="spares-h"
        className="flex flex-col gap-3"
      >
        <h2 id="spares-h" className="text-h2">
          Spare shirts
        </h2>
        <p>
          {stockSizes.length === 0
            ? "No spares in stock."
            : `In stock: ${stockSizes.map((s) => `${stock[s]} ${sizeLabel(s)}`).join(", ")}.`}
        </p>
        <form
          action={logSpareAction}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="spare-size" className="font-bold">
              Size
            </label>
            <select id="spare-size" name="size" className={control}>
              {SHIRT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {sizeLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="spare-qty" className="font-bold">
              How many
            </label>
            <input
              id="spare-qty"
              name="quantity"
              inputMode="numeric"
              required
              autoComplete="off"
              className={`${control} w-24`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="spare-note" className="font-bold">
              Note (optional)
            </label>
            <input
              id="spare-note"
              name="note"
              maxLength={200}
              autoComplete="off"
              className={control}
            />
          </div>
          <SubmitButton className="btn min-h-11 btn-secondary">
            Log spares
          </SubmitButton>
        </form>
      </section>

      <section
        id="waiting"
        aria-labelledby="waiting-h"
        className="flex flex-col gap-3"
      >
        <h2 id="waiting-h" className="text-h2">
          Waiting ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="text-text-muted">Nobody is waiting.</p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => {
              const inStock = (stock[r.size] ?? 0) > 0;
              return (
                <li
                  key={r.registrationId}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                >
                  <span>
                    <span className="font-bold">{r.name}</span>
                    <span className="block text-small text-text-muted">
                      {r.teamName} · {r.seasonName} · {sizeLabel(r.size)}
                    </span>
                  </span>
                  {inStock && (
                    <form
                      action={handOutSpareAction.bind(null, r.registrationId)}
                    >
                      <SubmitButton className="min-h-11 underline">
                        Hand out a spare {sizeLabel(r.size)}
                        <span className="sr-only"> to {r.name}</span>
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
