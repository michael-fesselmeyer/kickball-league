import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConfirmItsYou } from "@/components/confirm-its-you";
import { HelpLink } from "@/components/help-link";
import { PageLoading } from "@/components/page-loading";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db/client";
import { hasPasskey } from "@/db/queries/passkeys";
import { feeSettingsOf } from "@/db/queries/processing-fees";
import { profileOf } from "@/db/queries/profile";
import { bpsText, feesOn, methodQuotes } from "@/domain/money/processing-fee";
import { formatCents } from "@/domain/registration/pricing";
import { requirePermission, sessionIsFresh } from "@/lib/auth/permission";
import { activeLeague } from "@/lib/league/active";
import { saveFeeSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Processing fees" };

const PAGE = "/app/owner/processing-fees";

export default function ProcessingFeesPage(
  props: PageProps<"/[lang]/app/owner/processing-fees">,
) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <Suspense fallback={<PageLoading>Loading…</PageLoading>}>
        <ProcessingFees {...props} />
      </Suspense>
    </main>
  );
}

const ERRORS: Record<string, string> = {
  stale: "Confirm it's you first, then save again.",
  unconfirmed:
    "Tick the box to say the league has done everything on the list before turning this on.",
  bad_mode: "Choose whether payers cover fees.",
  bad_card_rate:
    "Enter the card rate as a percentage up to 10 and a fixed part up to $5, such as 2.9 and 0.30.",
  bad_bank_rate:
    "Enter the bank-transfer rate as a percentage up to 10 and a cap up to $100, such as 0.8 and 5.",
  bad_venmo_rate:
    "Enter Venmo's rate as a percentage up to 10 and a fixed part up to $5, such as 1.9 and 0.10.",
};

const input =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3";

/** An example price to show what payers would see. */
const EXAMPLE_CENTS = 6000;

async function ProcessingFees({
  searchParams,
}: PageProps<"/[lang]/app/owner/processing-fees">) {
  const subject = await requirePermission("processing_fees.manage", {
    next: PAGE,
  });
  const query = await searchParams;
  const league = await activeLeague();
  if (!league) return <p>There is no league here yet.</p>;
  const [settings, fresh, me, withPasskey] = await Promise.all([
    feeSettingsOf(db, league.id),
    sessionIsFresh(),
    profileOf(db, subject.userId),
    hasPasskey(db, subject.userId),
  ]);
  const error =
    typeof query.error === "string" ? ERRORS[query.error] : undefined;
  const saved = query.notice === "saved";
  const example = methodQuotes(
    EXAMPLE_CENTS,
    { ...settings, mode: "non_card_discount" },
    { bank: true, offApp: true },
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link
          href="/app/owner"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          Owner dashboard
        </Link>
        <h1 className="text-h1">Processing fees</h1>
        <HelpLink
          audience="owner"
          article="processing-fees"
          topic="processing fees"
        />
        <p className="text-text-muted">
          Card payments cost the league about 3% of every payment. When this is
          on, whoever pays by card, Apple Pay or Google Pay pays the card price,
          which covers that cost, and cash, Zelle and check cost the price
          alone. Bank transfers and a Venmo business profile cover their own
          smaller fees.
        </p>
        <p className="font-semibold">
          It is {feesOn(settings) ? "on" : "off"}.
        </p>
      </header>
      {error && (
        <p role="alert" className="rounded-lg border border-danger p-3">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-lg border border-success p-3">
          Saved.
        </p>
      )}

      <section
        aria-labelledby="before"
        className="flex flex-col gap-2 rounded-lg border border-warning p-4"
      >
        <h2 id="before" className="text-h2">
          Before turning it on
        </h2>
        <p>
          Passing a card fee on is regulated. The league should confirm the
          legal side with its own adviser first. In short:
        </p>
        <ul className="list-disc pl-6">
          <li>
            Ask Stripe, and the bank behind it if Stripe says so, whether the
            league must tell them first, and do it. Visa asks for notice 30 days
            before any card surcharge.
          </li>
          <li>
            New York caps any card fee at what the processor charges, and the
            total card price must be shown before anyone pays. The app does
            both, as long as the rates below are the league&apos;s real rates.
          </li>
          <li>
            Debit and prepaid cards can&apos;t be surcharged, so the app uses a
            card price with a lower price for cash, Zelle and check, which is
            allowed. Wherever the league posts a price elsewhere, post the card
            price too.
          </li>
          <li>
            Fill in how players pay with cash, Zelle and check below, so the
            free options are always easy to use.
          </li>
        </ul>
      </section>

      {!fresh && me && (
        <ConfirmItsYou
          what="change processing fees"
          email={me.email}
          next={PAGE}
          confirm={query.confirm}
          hasPasskey={withPasskey}
        />
      )}

      <form action={saveFeeSettingsAction} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-h3">Who covers fees</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5 accent-brand"
              type="radio"
              name="mode"
              value="off"
              defaultChecked={settings.mode === "off"}
            />
            Off: the league pays every fee (prices as they are)
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5 accent-brand"
              type="radio"
              name="mode"
              value="non_card_discount"
              defaultChecked={settings.mode === "non_card_discount"}
            />
            On: a card price, and a lower price for cash, Zelle and check
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-h3">Card, Apple Pay and Google Pay</legend>
          <p className="text-text-muted">
            Stripe&apos;s US rate is 2.9% + $0.30. If the league has a lower
            rate, enter it: the fee is never more than the rate entered.
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              Percent
              <input
                name="cardPercent"
                inputMode="decimal"
                required
                defaultValue={bpsText(settings.card.percentBps)}
                className={`${input} w-28`}
              />
            </label>
            <label className="flex flex-col gap-1">
              Plus, in dollars
              <input
                name="cardFixed"
                inputMode="decimal"
                required
                defaultValue={(settings.card.fixedCents / 100).toFixed(2)}
                className={`${input} w-28`}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-h3">Bank transfers</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5 accent-brand"
              type="checkbox"
              name="bankTransfers"
              defaultChecked={settings.bankTransfers}
            />
            Offer bank transfers for season fees
          </label>
          <p className="text-text-muted">
            Stripe&apos;s US rate is 0.8%, at most $5. A transfer takes a few
            business days to arrive; turn on bank payments in Stripe first.
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              Percent
              <input
                name="bankPercent"
                inputMode="decimal"
                required
                defaultValue={bpsText(settings.bank.percentBps)}
                className={`${input} w-28`}
              />
            </label>
            <label className="flex flex-col gap-1">
              At most, in dollars
              <input
                name="bankCap"
                inputMode="decimal"
                required
                defaultValue={(settings.bank.capCents / 100).toFixed(2)}
                className={`${input} w-28`}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-h3">Venmo</legend>
          <label className="flex min-h-11 items-center gap-3">
            <input
              className="size-5 accent-brand"
              type="checkbox"
              name="venmoBusiness"
              defaultChecked={settings.venmoBusiness}
            />
            The league takes Venmo on a business profile, which charges a fee
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              Percent
              <input
                name="venmoPercent"
                inputMode="decimal"
                required
                defaultValue={bpsText(settings.venmo.percentBps)}
                className={`${input} w-28`}
              />
            </label>
            <label className="flex flex-col gap-1">
              Plus, in dollars
              <input
                name="venmoFixed"
                inputMode="decimal"
                required
                defaultValue={(settings.venmo.fixedCents / 100).toFixed(2)}
                className={`${input} w-28`}
              />
            </label>
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-h3">How to pay with cash, Zelle or check</span>
          <span className="text-text-muted">
            Shown wherever players pay, for example who takes cash and where to
            send Zelle. Use the league&apos;s own payment details, not a
            person&apos;s.
          </span>
          <textarea
            name="freeMethodsNote"
            maxLength={500}
            rows={3}
            defaultValue={settings.freeMethodsNote}
            className={`${input} py-2`}
          />
        </label>

        <label className="flex min-h-11 items-start gap-3">
          <input
            className="mt-1 size-5 accent-brand"
            type="checkbox"
            name="confirmed"
            defaultChecked={feesOn(settings)}
          />
          The league has confirmed the legal side, told Stripe whatever it asked
          for, and entered its real rates.
        </label>

        <SubmitButton className="btn self-start btn-primary" disabled={!fresh}>
          Save
        </SubmitButton>
      </form>

      <section aria-labelledby="example" className="flex flex-col gap-2">
        <h2 id="example" className="text-h2">
          What payers would see for a {formatCents(EXAMPLE_CENTS)} price
        </h2>
        <ul className="flex flex-col gap-1">
          {example.map((q) => (
            <li key={q.method} className="flex justify-between gap-4">
              <span>{q.label}</span>
              <span className="tabular-nums">
                {formatCents(q.totalCents)}
                {q.feeCents > 0 && (
                  <span className="text-text-muted">
                    {" "}
                    (fee {formatCents(q.feeCents)})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
