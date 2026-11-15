import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { payInputs, payRate } from "@/db/queries/referee-pool";
import { seasonBySlug } from "@/db/queries/schedule-screen";
import { can } from "@/domain/authz/permissions";
import { money } from "@/domain/books/ledger";
import {
  dollarsField,
  PAYOUT_METHOD_LABELS,
  PAYOUT_METHODS,
  paySheet,
  payTotals,
} from "@/domain/referees/pay";
import { activeLeagueId } from "@/lib/league/active";
import { requirePermission } from "@/lib/auth/permission";
import { recordPayoutAction, setPayRateAction } from "./actions";

export const metadata: Metadata = { title: "Ref pay sheet" };

export default function PayPage(
  props: PageProps<"/app/admin/seasons/[season]/referees/pay">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Adding up the games…</PageLoading>}>
        <Pay {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  fee: "Enter the fee in dollars, from 0 to 1,000.",
  amount: "Enter the amount paid in dollars, more than 0 and up to 1,000.",
  method: "Choose cash or Venmo.",
  unknown_ref: "That person isn't a ref this season.",
  stale:
    "Someone recorded a payment to this ref a moment ago, so this one wasn't. Check the sheet, then try again if it's still owed.",
  unknown_season: "That season is gone.",
};
const NOTICES: Record<string, string> = {
  fee: "Fee saved. Everyone's pay is worked out again from it.",
  paid: "Payment recorded and added to the books as a Refs expense.",
};

async function Pay({
  params,
  searchParams,
}: PageProps<"/app/admin/seasons/[season]/referees/pay">) {
  const { season: slug } = await params;
  const query = await searchParams;
  const base = `/app/admin/seasons/${slug}/referees`;
  const subject = await requirePermission("referee.manage", {
    next: `${base}/pay`,
  });
  const season = await seasonBySlug(db, await activeLeagueId(), slug);
  if (!season) notFound();
  const [inputs, fee] = await Promise.all([
    payInputs(db, { seasonId: season.id, leagueId: season.leagueId }),
    payRate(db, season.id),
  ]);
  const rows = paySheet(inputs, fee);
  const totals = payTotals(rows);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const seesBooks = can(subject, "books.manage", {});

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href={base} className="underline">
          {season.name} referees
        </Link>
        <h1 className="text-h1">Ref pay sheet</h1>
        <p className="text-text-muted">
          A ref is owed the per-game fee for each game they worked: one they
          checked in for or reported the score of. Record cash or Venmo payments
          here; each one goes in the books as a Refs expense.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-success p-3">
          {notice}
          {query.notice === "paid" && seesBooks && (
            <>
              {" "}
              <Link href={`/app/books/${slug}`} className="underline">
                See the books
              </Link>
              .
            </>
          )}
        </p>
      )}

      <form
        action={setPayRateAction.bind(null, slug)}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1">
          Per-game fee, in dollars
          <input
            name="fee"
            inputMode="decimal"
            required
            defaultValue={fee === null ? "" : dollarsField(fee)}
            className="min-h-11 w-32 rounded-input border border-border-strong bg-surface px-3 tabular-nums"
          />
        </label>
        <SubmitButton className="btn btn-secondary">Save the fee</SubmitButton>
        {fee === null && (
          <p className="w-full text-small text-text-muted">
            No fee yet, so nobody is owed anything.
          </p>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="text-text-muted">
          No refs yet.{" "}
          <Link href={`${base}#pool`} className="underline">
            Add refs to the pool
          </Link>
          .
        </p>
      ) : (
        <section aria-labelledby="sheet" className="flex flex-col gap-3">
          <h2 id="sheet" className="text-h3">
            {totals.gamesWorked} games worked · {money(totals.owedCents)} owed ·{" "}
            {money(totals.paidCents)} paid · {money(totals.balanceCents)} to pay
          </h2>
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li
                key={r.userId}
                id={`ref-${r.userId}`}
                aria-label={r.name}
                className="flex flex-col gap-2 border-t border-border py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-bold">{r.name}</span>
                  <span className="tabular-nums">
                    {r.gamesWorked} {r.gamesWorked === 1 ? "game" : "games"} ·{" "}
                    {money(r.owedCents)} owed · {money(r.paidCents)} paid ·{" "}
                    <strong>
                      {r.balanceCents < 0
                        ? `${money(-r.balanceCents)} paid ahead`
                        : `${money(r.balanceCents)} to pay`}
                    </strong>
                  </span>
                </div>
                {r.balanceCents > 0 && (
                  <form
                    action={recordPayoutAction.bind(null, slug, r.userId)}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input
                      type="hidden"
                      name="paidBefore"
                      value={r.paidCents}
                    />
                    <label className="flex flex-col gap-1 text-small">
                      Amount
                      <input
                        name="amount"
                        inputMode="decimal"
                        required
                        defaultValue={dollarsField(r.balanceCents)}
                        aria-label={`Amount paid to ${r.name}`}
                        className="min-h-11 w-28 rounded-input border border-border-strong bg-surface px-3 text-body tabular-nums"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-small">
                      How
                      <select
                        name="method"
                        defaultValue="venmo"
                        aria-label={`How ${r.name} was paid`}
                        className="min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body"
                      >
                        {PAYOUT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYOUT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton className="btn btn-primary">
                      Mark paid
                      <span className="sr-only"> to {r.name}</span>
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
