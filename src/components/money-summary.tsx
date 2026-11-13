import { money } from "@/domain/books/ledger";
import type { MoneySummary } from "@/domain/dashboard/money";

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * A season's money summary (ADR 0035): category totals and how each fee
 * divides across them. The same component draws the owner's preview and
 * the public page, so the preview is exactly what visitors see. Bars are
 * plain elements with the numbers beside them; no script.
 */
export function MoneySummaryView({
  summary,
  headingLevel = 2,
}: {
  summary: MoneySummary;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const sub = headingLevel === 2 ? "text-h2" : "text-h3";
  const lines =
    summary.unspentCents > 0
      ? [
          ...summary.categories,
          {
            label: "Not spent yet",
            cents: summary.unspentCents,
            share:
              summary.collectedCents > 0
                ? summary.unspentCents / summary.collectedCents
                : 0,
          },
        ]
      : summary.categories;
  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3">
        <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
          <dt className="text-small text-text-muted">Collected</dt>
          <dd className="font-display text-h3 tabular-nums">
            {money(summary.collectedCents)}
          </dd>
        </div>
        <div className="flex flex-col rounded-lg border border-border bg-surface p-3">
          <dt className="text-small text-text-muted">Spent</dt>
          <dd className="font-display text-h3 tabular-nums">
            {money(summary.spentCents)}
          </dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <H className={sub}>Where it went</H>
        {lines.length === 0 ? (
          <p className="text-text-muted">No spending recorded yet.</p>
        ) : (
          <table className="w-full">
            <caption className="sr-only">
              Money spent by category, with each category&apos;s share
            </caption>
            <thead className="text-small text-text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 text-left font-normal">
                  Category
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-normal">
                  Total
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-normal">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label} className="border-t border-border">
                  <th
                    scope="row"
                    className="w-3/5 py-2 pr-3 text-left font-normal"
                  >
                    <span className="flex flex-col gap-1">
                      {l.label}
                      <span
                        aria-hidden="true"
                        className="block h-2.5 rounded-r-sm bg-chart-1"
                        style={{
                          width:
                            l.share > 0 ? `max(2px, ${l.share * 100}%)` : "0",
                        }}
                      />
                    </span>
                  </th>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {money(l.cents)}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {pct(l.share)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-small text-text-muted">
          Shares are of the money collected
          {summary.spentCents > summary.collectedCents
            ? "; this season spending ran over it, so they're of what was spent"
            : ""}
          .
        </p>
      </section>

      {summary.fees.map((fee) => (
        <section key={fee.label} className="flex flex-col gap-3">
          <H className={sub}>
            Where a {money(fee.cents)} {fee.label.toLowerCase()} goes
          </H>
          <ul className="flex flex-col">
            {fee.parts.map((p) => (
              <li
                key={p.label}
                className="flex min-h-11 items-center justify-between gap-3 border-t border-border py-2"
              >
                <span>{p.label}</span>
                <span className="tabular-nums">{money(p.cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
