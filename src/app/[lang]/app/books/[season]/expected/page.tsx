import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { recurringCosts } from "@/db/queries/books-upkeep";
import { CADENCE_LABELS, CADENCES } from "@/domain/books/expected";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  money,
} from "@/domain/books/ledger";
import { localDate } from "@/domain/books/ledger-csv";
import { LABEL_MAX } from "@/domain/books/forms";
import { requirePermission } from "@/lib/auth/permission";
import { booksSeason } from "../../load";
import { addRecurringAction, removeRecurringAction } from "./actions";

export const metadata: Metadata = { title: "Expected costs" };

export default function ExpectedPage(
  props: PageProps<"/[lang]/app/books/[season]/expected">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <Expected {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  label: `Name the cost in up to ${LABEL_MAX} characters, such as "Ref pay".`,
  amount: "Enter dollars, such as 120 or 450.",
  category: "Pick a category.",
  cadence: "Pick each season or each game day.",
  date: "Enter the first day it applies.",
  unknown_cost: "That cost was already removed.",
};

const NOTICES: Record<string, string> = {
  added: "Expected cost saved. It shows on the books when it's due.",
  removed: "That cost is no longer expected.",
};

const input = "min-h-11 rounded-md border border-border bg-surface px-2 py-1";

async function Expected({
  params,
  searchParams,
}: PageProps<"/[lang]/app/books/[season]/expected">) {
  const { season: slug } = await params;
  const page = `/app/books/${slug}/expected`;
  await requirePermission("books.manage", { next: page });
  const query = await searchParams;
  const { league, season } = await booksSeason(slug);
  const costs = await recurringCosts(db, league.id);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
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
          href={`/app/books/${slug}`}
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Books: {season.name}
        </Link>
        <h1 className="text-h1">Expected costs</h1>
        <p className="text-text-muted">
          Set a cost once, such as a permit, insurance, ref pay or the bar
          deposit. Each season or game day, the books list it for an owner to
          confirm with one tap, at this amount or another, or skip.
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
        </p>
      )}

      <section aria-labelledby="costs" className="flex flex-col gap-3">
        <h2 id="costs" className="text-h2">
          Set up
        </h2>
        {costs.length === 0 ? (
          <p className="text-text-muted">No expected costs yet.</p>
        ) : (
          <ul className="flex flex-col">
            {costs.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2"
              >
                <span className="flex flex-col">
                  <span>
                    {c.label} · {money(c.amountCents)}
                  </span>
                  <span className="text-small text-text-muted">
                    {CADENCE_LABELS[c.cadence]} from {day(c.startsOn)} ·{" "}
                    {CATEGORY_LABELS[c.category]}
                  </span>
                </span>
                <form action={removeRecurringAction.bind(null, slug)}>
                  <input type="hidden" name="costId" value={c.id} />
                  <SubmitButton className="btn btn-secondary">
                    Stop expecting<span className="sr-only"> {c.label}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-cost" className="flex flex-col gap-3">
        <h2 id="add-cost" className="text-h2">
          Add an expected cost
        </h2>
        <form
          action={addRecurringAction.bind(null, slug)}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1">
            <span className="text-small">What it is</span>
            <input
              name="label"
              required
              maxLength={LABEL_MAX}
              autoComplete="off"
              placeholder="Ref pay"
              className={input}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-small">Usual amount in dollars</span>
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
              <select
                name="category"
                required
                defaultValue="refs"
                className={input}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-small">Starting</span>
              <input
                type="date"
                name="startsOn"
                required
                defaultValue={localDate(new Date(), league.timeZone)}
                className={input}
              />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-small">How often</legend>
            <div className="flex flex-wrap gap-2">
              {CADENCES.map((c) => (
                <label
                  key={c}
                  className="check-row rounded-md border border-border px-3 py-2 has-[:checked]:border-brand has-[:checked]:font-bold"
                >
                  <input
                    type="radio"
                    name="cadence"
                    value={c}
                    required
                    defaultChecked={c === "game_day"}
                  />
                  {CADENCE_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-small text-text-muted">
            A season cost is expected on the season&apos;s first day; a game-day
            cost on every day with games, leaving out cancelled and postponed
            ones. In a season with a per-game ref fee on the ref pay sheet, a
            game-day Refs cost isn&apos;t expected: each payout marked on the
            pay sheet goes into the books on its own.
          </p>
          <SubmitButton className="btn self-start btn-primary">
            Save expected cost
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
