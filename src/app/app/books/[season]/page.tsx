import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HelpLink } from "@/components/help-link";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { seasonBooks, storedBytes } from "@/db/queries/books";
import { seasonPermitPlan } from "@/db/queries/permit-plan";
import {
  lastCategory,
  owedList,
  ownersByName,
  refPaySummary,
  seasonExpected,
} from "@/db/queries/books-upkeep";
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
import { feesDueOn } from "@/domain/permits/fees";
import { requirePermission } from "@/lib/auth/permission";
import { FileInput } from "../file-input";
import { booksSeason } from "../load";
import { SeasonPicker } from "../season-picker";
import {
  addExpenseAction,
  attachReceiptAction,
  confirmExpectedAction,
  noReceiptAction,
  reimburseAction,
  removeExpenseAction,
  skipExpectedAction,
} from "./actions";

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
  unknown_expense: "That expense was already removed.",
  unknown_season: "That season isn't in this league.",
  unknown_payer: "Pick league money or one of the owners.",
  no_file: "Choose a photo or PDF of the receipt.",
  has_receipt: "That expense already has a receipt.",
  not_expected: "That cost was already confirmed or skipped.",
  nothing_owed: "That was already marked reimbursed.",
  ...(FILE_MESSAGES satisfies Record<FileProblem, string>),
};

const NOTICES: Record<string, string> = {
  added: "Expense added.",
  removed: "Expense removed.",
  receipt: "Receipt added.",
  no_receipt: "Marked as having no receipt.",
  confirmed: "Expected cost added to the books.",
  skipped: "Expected cost skipped.",
  reimbursed: "Marked reimbursed.",
};

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";
const chip =
  "flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 has-[:checked]:border-brand has-[:checked]:font-bold";

const dollars = (cents: number) => (cents / 100).toFixed(2);

async function Books({
  params,
  searchParams,
}: PageProps<"/app/books/[season]">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season, seasons } = await booksSeason(slug);
  const now = new Date();
  const today = localDate(now, league.timeZone);
  const [books, used, plan, recent, owners, expected, owed, refPay] =
    await Promise.all([
      seasonBooks(db, season),
      storedBytes(db, league.id),
      seasonPermitPlan(db, season.id, league, now),
      lastCategory(db, league.id),
      ownersByName(db, league.id),
      seasonExpected(db, {
        leagueId: league.id,
        season,
        timeZone: league.timeZone,
        today,
      }),
      owedList(db, league.id),
      refPaySummary(db, { leagueId: league.id, seasonId: season.id }),
    ]);
  const { ledger } = books;
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const count = (name: string) =>
    typeof query[name] === "string" ? Number(query[name]) || 0 : 0;
  const notice =
    query.notice === "imported"
      ? `Imported ${count("imported")} ${count("imported") === 1 ? "expense" : "expenses"}${count("skipped") > 0 ? `; ${count("skipped")} already in the books were skipped` : ""}.`
      : typeof query.notice === "string"
        ? NOTICES[query.notice]
        : undefined;
  const day = (on: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${on}T12:00:00Z`));
  const preselected = recent ?? "other";
  const missing = books.expenses.filter(
    (e) =>
      !e.receiptFileId &&
      !e.noReceipt &&
      !e.imported &&
      !e.expected &&
      !e.fromPaySheet,
  ).length;

  const payerSelect = (id: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-small">Paid from</span>
      <select id={id} name="paidBy" className={input} defaultValue="">
        <option value="">League money</option>
        {owners.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.name}, out of pocket
          </option>
        ))}
      </select>
    </label>
  );

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
        <HelpLink audience="owner" article="books" topic="keeping the books" />
        <p className="text-text-muted">
          Money in comes from the payments the app records. Add what the league
          spends as you go; a receipt can come later. Only owners see this.
        </p>
        <nav aria-label="Books" className="flex flex-wrap gap-3">
          <SeasonPicker
            seasons={seasons}
            current={season.slug}
            path={(s) => `/app/books/${s}`}
          />
          <Link
            href={`/app/books/${slug}/import`}
            className="btn btn-secondary"
          >
            Import a statement
          </Link>
          <Link
            href={`/app/books/${slug}/expected`}
            className="btn btn-secondary"
          >
            Expected costs
          </Link>
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

      <section aria-labelledby="quick-add" className="flex flex-col gap-3">
        <h2 id="quick-add" className="text-h2">
          Add an expense
        </h2>
        <form
          action={addExpenseAction.bind(null, slug)}
          className="flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1">
            <span className="text-small">Amount in dollars</span>
            <input
              name="amount"
              inputMode="decimal"
              required
              autoComplete="off"
              className={`${input} w-40 text-h3`}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-small">Category</legend>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <label key={c} className={chip}>
                  <input
                    type="radio"
                    name="category"
                    value={c}
                    required
                    defaultChecked={c === preselected}
                  />
                  {CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <details className="flex flex-col gap-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center">
              Date, note, receipt and who paid
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-small">Date</span>
                  <input
                    type="date"
                    name="spentOn"
                    defaultValue={today}
                    className={input}
                  />
                </label>
                {payerSelect("paid-by-new")}
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
              <fieldset className="flex flex-col gap-2">
                <legend className="text-small">Receipt</legend>
                <div className="flex flex-wrap gap-2">
                  <label className={chip}>
                    <input
                      type="radio"
                      name="receiptChoice"
                      value="later"
                      defaultChecked
                    />
                    Add it later
                  </label>
                  <label className={chip}>
                    <input type="radio" name="receiptChoice" value="none" />
                    There isn&apos;t one
                  </label>
                </div>
              </fieldset>
              <FileInput
                name="receipt"
                label="Receipt photo (optional)"
                hint={`Take a photo or pick one. It's shrunk to under 1 MB. Storage used: ${storageLine(used)}.`}
                camera
              />
            </div>
          </details>
          <SubmitButton className="btn self-start btn-primary">
            Add expense
          </SubmitButton>
        </form>
      </section>

      {(expected.due.length > 0 ||
        expected.next.length > 0 ||
        refPay !== null) && (
        <section aria-labelledby="expected" className="flex flex-col gap-3">
          <h2 id="expected" className="text-h2">
            Expected costs
          </h2>
          {refPay && (
            <p className="rounded-lg border border-border p-3">
              <strong>Ref pay comes from the pay sheet</strong>:{" "}
              {refPay.gamesWorked === 1
                ? "1 game worked"
                : `${refPay.gamesWorked} games worked`}{" "}
              at {money(refPay.feeCents)} a game,{" "}
              {refPay.balanceCents > 0
                ? `${money(refPay.balanceCents)} still to pay`
                : "all paid"}
              . Each payout marked there is added to the books under Refs.{" "}
              <Link
                href={`/app/admin/seasons/${slug}/referees/pay`}
                className="underline"
              >
                Open the pay sheet
              </Link>
            </p>
          )}
          {expected.due.length === 0 ? (
            <p className="text-text-muted">Nothing waiting to confirm.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {expected.due.map((o) => {
                const id = `${o.costId}-${o.dueOn}`;
                const name = `${o.label}, ${day(o.dueOn)}`;
                return (
                  <li
                    key={id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3"
                  >
                    <span>
                      <span className="font-bold">{o.label}</span> ·{" "}
                      {day(o.dueOn)} · {CATEGORY_LABELS[o.category]}
                    </span>
                    <form
                      action={confirmExpectedAction.bind(null, slug)}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="costId" value={o.costId} />
                      <input type="hidden" name="dueOn" value={o.dueOn} />
                      <label className="flex flex-col gap-1">
                        <span className="text-small">
                          Amount<span className="sr-only"> for {name}</span>
                        </span>
                        <input
                          name="amount"
                          inputMode="decimal"
                          required
                          autoComplete="off"
                          defaultValue={dollars(o.amountCents)}
                          className={`${input} w-28`}
                        />
                      </label>
                      {payerSelect(`paid-by-${id}`)}
                      <SubmitButton className="btn btn-primary">
                        Confirm<span className="sr-only"> {name}</span>
                      </SubmitButton>
                      <SubmitButton
                        formAction={skipExpectedAction.bind(null, slug)}
                        formNoValidate
                        className="btn btn-secondary"
                      >
                        Skip<span className="sr-only"> {name}</span>
                      </SubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          {expected.next.length > 0 && (
            <p className="text-small text-text-muted">
              Coming up:{" "}
              {expected.next
                .map(
                  (o) =>
                    `${o.label} on ${day(o.dueOn)} (${money(o.amountCents)})`,
                )
                .join("; ")}
              .
            </p>
          )}
        </section>
      )}

      {owed.length > 0 && (
        <section aria-labelledby="owed" className="flex flex-col gap-3">
          <h2 id="owed" className="text-h2">
            Owed to owners
          </h2>
          <p className="text-text-muted">
            Costs an owner paid out of pocket, across every season. Pay them
            back, then mark it here.
          </p>
          <ul className="flex flex-col">
            {owed.map((o) => (
              <li
                key={o.paidBy}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span>
                  {o.name} is owed{" "}
                  <span className="font-bold tabular-nums">
                    {money(o.cents)}
                  </span>
                </span>
                <form action={reimburseAction.bind(null, slug)}>
                  <input type="hidden" name="paidBy" value={o.paidBy} />
                  <input
                    type="hidden"
                    name="expenseIds"
                    value={o.expenseIds.join(",")}
                  />
                  <SubmitButton className="btn btn-secondary">
                    Reimbursed<span className="sr-only"> {o.name}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        {plan.expectedCents > 0 && (
          <p className="rounded-lg border border-border p-3">
            <strong>
              Expected: {money(plan.expectedCents)} of permit fees
            </strong>
            , estimated from NYC Parks&apos; rates for the permits with no cost
            entered yet, due {day(feesDueOn(season.startsOn))}. With them, the
            net would be {money(ledger.netCents - plan.expectedCents)}. Enter
            each permit&apos;s real cost on the{" "}
            <Link href={`/app/books/${slug}/permits`} className="underline">
              permits screen
            </Link>{" "}
            once Parks bills it.
          </p>
        )}
        {ledger.income.creditAppliedCents > 0 && (
          <p className="text-small text-text-muted">
            Players also spent {money(ledger.income.creditAppliedCents)} of
            league credit, which isn&apos;t counted as money in.
          </p>
        )}
      </section>

      <section aria-labelledby="expenses" className="flex flex-col gap-3">
        <h2 id="expenses" className="text-h2">
          Expenses
        </h2>
        {missing > 0 && (
          <p className="text-text-muted">
            {missing === 1
              ? "1 expense is waiting on a receipt."
              : `${missing} expenses are waiting on a receipt.`}
          </p>
        )}
        {books.expenses.length === 0 ? (
          <p className="text-text-muted">No expenses yet this season.</p>
        ) : (
          <ul className="flex flex-col">
            {books.expenses.map((e) => {
              const name = `${CATEGORY_LABELS[e.category]}, ${day(e.spentOn)}`;
              const waiting =
                !e.receiptFileId &&
                !e.noReceipt &&
                !e.imported &&
                !e.expected &&
                !e.fromPaySheet;
              const tags = [
                e.paidByName &&
                  (e.reimbursedAt
                    ? `${e.paidByName} paid, reimbursed`
                    : `${e.paidByName} paid, owed`),
                e.imported && "From a statement",
                e.expected && "Expected cost",
                e.fromPaySheet && "From the ref pay sheet",
                e.noReceipt && "No receipt",
                waiting && "Receipt to add",
              ].filter(Boolean);
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-2 border-b border-border py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-col">
                      <span>
                        {CATEGORY_LABELS[e.category]} · {money(e.amountCents)}
                      </span>
                      <span className="text-small text-text-muted">
                        {day(e.spentOn)}
                        {e.note ? ` · ${e.note}` : ""}
                      </span>
                      {tags.length > 0 && (
                        <span className="text-small">{tags.join(" · ")}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-3">
                      {e.receiptFileId && (
                        <a
                          href={`/app/books/files/${e.receiptFileId}`}
                          className="inline-flex min-h-11 items-center underline"
                        >
                          Receipt<span className="sr-only"> for {name}</span>
                        </a>
                      )}
                      <form action={removeExpenseAction.bind(null, slug)}>
                        <input type="hidden" name="expenseId" value={e.id} />
                        <SubmitButton className="btn btn-secondary">
                          Remove<span className="sr-only"> {name}</span>
                        </SubmitButton>
                      </form>
                    </span>
                  </div>
                  {!e.receiptFileId && !e.noReceipt && !e.fromPaySheet && (
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center">
                        Add a receipt
                        <span className="sr-only"> for {name}</span>
                      </summary>
                      <form
                        action={attachReceiptAction.bind(null, slug)}
                        className="mt-2 flex flex-col gap-3"
                      >
                        <input type="hidden" name="expenseId" value={e.id} />
                        <FileInput
                          name="receipt"
                          label={`Receipt for ${name}`}
                          hint="A photo, or a PDF under 1 MB."
                        />
                        <div className="flex flex-wrap gap-3">
                          <SubmitButton className="btn btn-primary">
                            Save receipt
                          </SubmitButton>
                          <SubmitButton
                            formAction={noReceiptAction.bind(null, slug)}
                            formNoValidate
                            className="btn btn-secondary"
                          >
                            There isn&apos;t one
                          </SubmitButton>
                        </div>
                      </form>
                    </details>
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
