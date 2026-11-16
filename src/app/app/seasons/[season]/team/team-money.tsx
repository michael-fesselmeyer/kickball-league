import type { TeamBalance } from "@/db/queries/team-balance";
import { PayMethods } from "@/components/pay-methods";
import { creditToApply } from "@/domain/money/credit";
import {
  type FeeSettings,
  feeFor,
  methodQuotes,
} from "@/domain/money/processing-fee";
import { formatCents } from "@/domain/registration/pricing";
import {
  payBalanceAction,
  removeGuaranteeAction,
  startGuaranteeSetup,
} from "./money-actions";
import { SubmitButton } from "@/components/submit-button";

const NOTICES: Record<string, { text: string; good: boolean }> = {
  saving: {
    text: "Card saved with Stripe. It shows here as soon as Stripe confirms, usually within a few seconds.",
    good: true,
  },
  removed: { text: "Card removed. It won't be charged.", good: true },
  balance_paid: {
    text: "Thanks! The balance is paid once Stripe confirms.",
    good: true,
  },
  covered: {
    text: "Your league credit covered the balance. Nothing to pay.",
    good: true,
  },
  paid_up: { text: "The team fee is already covered.", good: true },
  cancelled: { text: "Cancelled. Nothing was saved or charged.", good: false },
  off: { text: "Online payment is not set up yet.", good: false },
  too_many: {
    text: "That's a lot of payment tries in an hour. Wait a bit, then try again.",
    good: false,
  },
  in_progress: {
    text: "Your checkout is still opening. Wait a moment, then tap Pay again.",
    good: false,
  },
  failed: {
    text: "Stripe couldn't start that. Try again in a minute.",
    good: false,
  },
  processing: {
    text: "Your bank transfer is on its way. It takes a few business days; the balance updates when it arrives.",
    good: true,
  },
};

export type GuaranteeView = {
  card: string;
  chargeOn: string | null;
  charge: "none" | "pending" | "paid" | "declined";
} | null;

/**
 * A split-pay team's fee for its captains: what is paid and left, a button
 * to pay the rest, and the card that guarantees it (roadmap item 13).
 */
export function TeamMoney({
  slug,
  balance,
  deadline,
  guarantee,
  creditCents,
  paymentsOn,
  notice,
  fees,
}: {
  slug: string;
  balance: TeamBalance;
  deadline: string | null;
  guarantee: GuaranteeView;
  creditCents: number;
  paymentsOn: boolean;
  notice: string | undefined;
  /** The league's processing-fee setting (ADR 0082). */
  fees: FeeSettings;
}) {
  const message = notice ? NOTICES[notice] : undefined;
  const paidPct = Math.min(
    100,
    Math.round((balance.paidCents * 100) / Math.max(1, balance.feeCents)),
  );
  const left = balance.balanceCents;
  // Totals for each way to pay what's left, credit used as the form starts.
  const quotes = methodQuotes(left - creditToApply(left, creditCents), fees, {
    bank: true,
    offApp: false,
  });
  // The guarantee's deadline charge is a card payment at the card price.
  const guaranteeFee = feeFor("card", left, fees);
  return (
    <section aria-labelledby="team-fee" className="flex flex-col gap-3">
      <h2 id="team-fee" className="text-h2">
        Team fee
      </h2>
      {message && (
        <p
          role={message.good ? "status" : "alert"}
          className={`rounded-lg border p-3 ${message.good ? "border-success" : "border-warning"}`}
        >
          {message.text}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <p>
          {formatCents(balance.paidCents)} of {formatCents(balance.feeCents)}{" "}
          paid.{" "}
          {left > 0 ? (
            <strong>
              {formatCents(left)} left{deadline ? `, due ${deadline}` : ""}.
            </strong>
          ) : (
            <strong className="text-success">All paid. You&apos;re in!</strong>
          )}
        </p>
        <div
          aria-hidden="true"
          className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${paidPct}%` }}
          />
        </div>
      </div>

      {left > 0 && paymentsOn && (
        <form
          action={payBalanceAction.bind(null, slug)}
          className="flex flex-col gap-2"
        >
          {creditCents > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="useCredit" defaultChecked />
              Use my {formatCents(creditCents)} league credit
            </label>
          )}
          <PayMethods
            quotes={quotes}
            freeMethodsNote={fees.freeMethodsNote}
            adjusted={creditCents > 0}
          />
          <SubmitButton className="btn self-start btn-secondary">
            {quotes.length > 0
              ? "Pay the rest online with Stripe"
              : `Pay the remaining ${formatCents(left)}`}
          </SubmitButton>
        </form>
      )}

      {guarantee ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p>
            <strong>{guarantee.card}</strong> guarantees the balance.
          </p>
          {guarantee.charge === "none" && left > 0 && (
            <p className="text-small text-text-muted">
              {guarantee.chargeOn
                ? `It will be charged for whatever is still unpaid on ${guarantee.chargeOn}.`
                : "We'll email you 72 hours before the deadline, then charge it for whatever is still unpaid."}{" "}
              Anything your teammates pay first comes off the charge.
              {guaranteeFee > 0 &&
                ` The charge is at the card price: today that's ${formatCents(left + guaranteeFee)}, including a ${formatCents(guaranteeFee)} card processing fee.`}
            </p>
          )}
          {guarantee.charge === "pending" && (
            <p className="text-small">The deadline charge is processing.</p>
          )}
          {guarantee.charge === "paid" && (
            <p className="text-small text-success">
              The deadline charge went through.
            </p>
          )}
          {guarantee.charge === "declined" && (
            <p className="text-small text-danger">
              The deadline charge was declined. Pay the balance above, or save
              another card.
            </p>
          )}
          {guarantee.charge === "none" && (
            <form action={removeGuaranteeAction.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Remove card
              </SubmitButton>
            </form>
          )}
        </div>
      ) : (
        left > 0 &&
        paymentsOn && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p>
              <strong>Stop chasing payments.</strong> Save a card to guarantee
              the balance. Nothing is charged now. 72 hours before the deadline
              we email you what&apos;s left, then charge only that
              {guaranteeFee > 0 ? ", plus the card processing fee" : ""}.
            </p>
            <form action={startGuaranteeSetup.bind(null, slug)}>
              <SubmitButton className="btn btn-secondary">
                Save a card as guarantee
              </SubmitButton>
            </form>
          </div>
        )
      )}
    </section>
  );
}
