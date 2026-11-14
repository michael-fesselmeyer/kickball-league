import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/db/client";
import { seasonBooks, storedBytes } from "@/db/queries/books";
import {
  FILE_MESSAGES,
  type FileProblem,
  storageLine,
} from "@/domain/books/files";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  money,
} from "@/domain/books/ledger";
import { localDate } from "@/domain/books/ledger-csv";
import { requirePermission } from "@/lib/auth/permission";
import { FileInput } from "../file-input";
import { booksSeason } from "../load";
import { SeasonPicker } from "../season-picker";
import { addExpenseAction, removeExpenseAction } from "./actions";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Books" };

export default function BooksPage(props: PageProps<"/app/books/[season]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Books {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  date: "Enter the date the money was spent.",
  amount: "Enter dollars, such as 45 or 129.99.",
  category: "Pick a category.",
  note: "Keep the note to 200 characters.",
  unknown_expense: "That expense is already gone.",
  unknown_season: "That season isn't in this league.",
  ...(FILE_MESSAGES satisfies Record<FileProblem, string>),
};

const NOTICES: Record<string, string> = {
  added: "Expense added.",
  removed: "Expense removed.",
};

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

async function Books({
  params,
  searchParams,
}: PageProps<"/app/books/[season]">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season, seasons } = await booksSeason(slug);
  const [books, used] = await Promise.all([
    seasonBooks(db, season),
    storedBytes(db, league.id),
  ]);
  const { ledger } = books;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const today = localDate(new Date(), league.timeZone);
  const day = (on: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${on}T12:00:00Z`));

  return (
    <>
      <header className="flex flex-col gap-2">
        <Link
          href="/app/admin"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          League admin
        </Link>
        <h1 className="text-h1">Books: {season.name}</h1>
        <p className="text-text-muted">
          Money in comes from the payments the app records. Add what the league
          spends, with a photo of the receipt. Only owners see this.
        </p>
        <nav aria-label="Books" className="flex flex-wrap gap-3">
          <SeasonPicker
            seasons={seasons}
            current={season.slug}
            path={(s) => `/app/books/${s}`}
          />
          <Link
            href={`/app/books/${slug}/permits`}
            className="btn btn-secondary"
          >
            Permits and insurance
          </Link>
          <a
            href={`/app/books/${slug}/ledger.csv`}
            className="btn btn-secondary"
            download
          >
            Download CSV
          </a>
        </nav>
      </header>

      <section aria-labelledby="ledger" className="flex flex-col gap-3">
        <h2 id="ledger" className="text-h2">
          Ledger
        </h2>
        <table className="w-full text-left">
          <caption className="sr-only">
            Money in, money out by category, and net for {season.name}
          </caption>
          <tbody>
            <tr className="border-b border-border">
              <th scope="row" className="py-2 font-normal">
                Paid in the app
              </th>
              <td className="py-2 text-right tabular-nums">
                {money(ledger.income.inAppCents)}
              </td>
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="py-2 font-normal">
                Paid outside the app (cash, Venmo)
              </th>
              <td className="py-2 text-right tabular-nums">
                {money(ledger.income.offAppCents)}
              </td>
            </tr>
            <tr className="border-b border-border">
              <th scope="row" className="py-2 font-normal">
                Refunds
              </th>
              <td className="py-2 text-right tabular-nums">
                {money(-ledger.income.refundsCents)}
              </td>
            </tr>
            <tr className="border-b-2 border-border-strong">
              <th scope="row" className="py-2">
                Money in
              </th>
              <td className="py-2 text-right font-bold tabular-nums">
                {money(ledger.income.totalCents)}
              </td>
            </tr>
            {ledger.expenses.map((e) => (
              <tr key={e.category} className="border-b border-border">
                <th scope="row" className="py-2 font-normal">
                  {e.label}
                  {e.category === "fields_permits" &&
                    ledger.permitCostCents > 0 && (
                      <span className="block text-small text-text-muted">
                        Includes {money(ledger.permitCostCents)} of permit costs
                      </span>
                    )}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {money(-e.cents)}
                </td>
              </tr>
            ))}
            <tr className="border-b-2 border-border-strong">
              <th scope="row" className="py-2">
                Money out
              </th>
              <td className="py-2 text-right font-bold tabular-nums">
                {money(-ledger.expenseTotalCents)}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2 text-h3">
                Net
              </th>
              <td className="py-2 text-right text-h3 tabular-nums">
                {money(ledger.netCents)}
              </td>
            </tr>
          </tbody>
        </table>
        {ledger.income.creditAppliedCents > 0 && (
          <p className="text-small text-text-muted">
            Players also spent {money(ledger.income.creditAppliedCents)} of
            league credit, which isn&apos;t counted as money in.
          </p>
        )}
      </section>

      <section aria-labelledby="expenses" className="flex flex-col gap-3">
        <h2 id="expenses" className="text-h2">
          Add an expense
        </h2>
        {error && (
          <p role="alert" className="rounded-lg border border-danger p-3">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-lg border border-success p-3">
            {notice}
          </p>
        )}
        <form
          action={addExpenseAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-small">Date</span>
              <input
                type="date"
                name="spentOn"
                required
                defaultValue={today}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Amount in dollars</span>
              <input
                name="amount"
                inputMode="decimal"
                required
                autoComplete="off"
                className={`${input} w-32`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Category</span>
              <select name="category" required className={input}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-small">Note</span>
            <input
              name="note"
              maxLength={200}
              autoComplete="off"
              className={input}
            />
          </label>
          <FileInput
            name="receipt"
            label="Receipt photo (optional)"
            hint={`Take a photo or pick one. It's shrunk to under 1 MB. Storage used: ${storageLine(used)}.`}
            camera
          />
          <SubmitButton className="btn self-start btn-primary">
            Add expense
          </SubmitButton>
        </form>
      </section>

      <section aria-labelledby="spent" className="flex flex-col gap-3">
        <h2 id="spent" className="text-h2">
          Expenses
        </h2>
        {books.expenses.length === 0 ? (
          <p className="text-text-muted">No expenses yet this season.</p>
        ) : (
          <ul className="flex flex-col">
            {books.expenses.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span className="flex flex-col">
                  <span>
                    {CATEGORY_LABELS[e.category]} · {money(e.amountCents)}
                  </span>
                  <span className="text-small text-text-muted">
                    {day(e.spentOn)}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {e.receiptFileId && (
                    <a
                      href={`/app/books/files/${e.receiptFileId}`}
                      className="inline-flex min-h-11 items-center underline"
                    >
                      Receipt
                      <span className="sr-only">
                        {" "}
                        for {CATEGORY_LABELS[e.category]}, {day(e.spentOn)}
                      </span>
                    </a>
                  )}
                  <form action={removeExpenseAction.bind(null, slug)}>
                    <input type="hidden" name="expenseId" value={e.id} />
                    <SubmitButton className="btn btn-secondary">
                      Remove
                      <span className="sr-only">
                        {" "}
                        {CATEGORY_LABELS[e.category]}, {day(e.spentOn)}
                      </span>
                    </SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
