"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { PreviewRow } from "@/db/queries/books-upkeep";
import type { PreviewState } from "./actions";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  money,
} from "@/domain/books/ledger";
import { FormError } from "@/components/form-error";

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

const STATUS: Record<Exclude<PreviewRow["status"], "new">, string> = {
  imported: "Already imported; it will be skipped.",
  maybe_entered:
    "An expense with this amount was entered by hand within 3 days. Left unticked in case it's the same one.",
  transfer:
    "Looks like money moving between accounts, not a cost. Left unticked.",
  outside_season:
    "Dated well outside this season. Left unticked; import it into its own season instead.",
};

/** "1 row", "3 rows". */
const rows = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const day = (on: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${on}T12:00:00Z`));

/**
 * Step one reads the statement and shows the money-out rows; step two
 * imports the ticked ones with the categories chosen. Each row's details
 * travel back in hidden fields and are checked again on the server.
 */
export function ImportForm({
  preview,
  importRows,
  seasonName,
}: {
  preview: (state: PreviewState, form: FormData) => Promise<PreviewState>;
  importRows: (form: FormData) => Promise<void>;
  seasonName: string;
}) {
  const [state, action, pending] = useActionState(preview, {
    kind: "empty",
  });

  return (
    <>
      <form action={action} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-small">Statement (CSV)</span>
          <input
            type="file"
            name="statement"
            required
            accept=".csv,text/csv"
            aria-describedby="statement-hint"
            className="min-h-11 rounded-md border border-border bg-surface px-2 py-2"
          />
          <span id="statement-hint" className="text-small text-text-muted">
            The file is read, not kept. Account and card numbers are left out.
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="btn self-start btn-primary"
        >
          {pending ? "Reading…" : "Preview"}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        <FormError
          message={state.kind === "error" ? state.message : null}
          attempt={state}
        />
        {state.kind === "preview" && (
          <section aria-labelledby="preview" className="flex flex-col gap-3">
            <h2 id="preview" className="text-h2">
              Preview
            </h2>
            <p>
              {state.rows.length === 0
                ? "No money-out rows in this statement."
                : `${state.rows.length} money-out ${state.rows.length === 1 ? "row" : "rows"} from a ${state.source === "venmo" ? "Venmo statement" : "bank export"}. Untick any that aren't league costs; they go into ${seasonName}.`}
            </p>
            {(state.moneyIn > 0 ||
              state.transfers > 0 ||
              state.unreadable > 0 ||
              state.overLimit > 0) && (
              <ul className="list-disc pl-5 text-small text-text-muted">
                {state.moneyIn > 0 && (
                  <li>
                    {rows(state.moneyIn, "money-in row")} (payments, refunds,
                    transfers in) left out: the app records the league&apos;s
                    income from its payments.
                  </li>
                )}
                {state.transfers > 0 && (
                  <li>
                    {rows(state.transfers, "Venmo transfer")} to a bank left
                    out: money moving, not spent.
                  </li>
                )}
                {state.unreadable > 0 && (
                  <li>
                    {rows(state.unreadable, "row")} left out because the date or
                    amount couldn&apos;t be read.
                  </li>
                )}
                {state.overLimit > 0 && (
                  <li>
                    {rows(state.overLimit, "more row")} left out; import a
                    shorter date range for those.
                  </li>
                )}
              </ul>
            )}
            {state.rows.length > 0 && (
              <form action={importRows} className="flex flex-col gap-3">
                <ul className="flex flex-col">
                  {state.rows.map((row, i) => {
                    const name = `${row.description}, ${day(row.spentOn)}, ${money(row.amountCents)}`;
                    return (
                      <li
                        key={`${i}-${row.key}`}
                        className="flex flex-col gap-2 border-b border-border py-3"
                      >
                        <label className="check-row-top">
                          <input
                            type="checkbox"
                            name="row"
                            value={i}
                            defaultChecked={row.status === "new"}
                            disabled={row.status === "imported"}
                            className="mt-1"
                          />
                          <span className="sr-only">Import </span>
                          {row.description}
                          <span className="ml-auto text-small whitespace-nowrap text-text-muted tabular-nums">
                            {day(row.spentOn)} · {money(row.amountCents)}
                          </span>
                        </label>
                        {row.status !== "new" && (
                          <p className="text-small">{STATUS[row.status]}</p>
                        )}
                        {row.status !== "imported" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-small">
                              Category
                              <span className="sr-only"> for {name}</span>
                            </span>
                            <select
                              name={`category-${i}`}
                              defaultValue={row.category ?? "other"}
                              className={input}
                            >
                              {EXPENSE_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {CATEGORY_LABELS[c]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <input
                          type="hidden"
                          name={`key-${i}`}
                          value={row.key}
                        />
                        <input
                          type="hidden"
                          name={`spentOn-${i}`}
                          value={row.spentOn}
                        />
                        <input
                          type="hidden"
                          name={`amount-${i}`}
                          value={row.amountCents}
                        />
                        <input
                          type="hidden"
                          name={`description-${i}`}
                          value={row.description}
                        />
                      </li>
                    );
                  })}
                </ul>
                <SubmitButton className="btn self-start btn-primary">
                  Import ticked rows
                </SubmitButton>
              </form>
            )}
          </section>
        )}
      </div>
    </>
  );
}
