import type { TeamBalance } from "@/db/queries/team-balance";
import { formatCents } from "@/domain/registration/pricing";
import {
  payBalanceAction,
  removeGuaranteeAction,
  startGuaranteeSetup,
} from "./money-actions";

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
  failed: {
    text: "Stripe could not start that. Try again in a minute.",
    good: false,
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
}: {
  slug: string;
  balance: TeamBalance;
  deadline: string | null;
  guarantee: GuaranteeView;
  creditCents: number;
  paymentsOn: boolean;
  notice: string | undefined;
}) {
  const message = notice ? NOTICES[notice] : undefined;
  const paidPct = Math.min(
    100,
    Math.round((balance.paidCents * 100) / Math.max(1, balance.feeCents)),
  );
  const left = balance.balanceCents;
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
          <button type="submit" className="btn self-start btn-secondary">
            Pay the remaining {formatCents(left)}
          </button>
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
              <button type="submit" className="btn btn-secondary">
                Remove card
              </button>
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
              we email you what&apos;s left, then charge only that.
            </p>
            <form action={startGuaranteeSetup.bind(null, slug)}>
              <button type="submit" className="btn btn-secondary">
                Save a card as guarantee
              </button>
            </form>
          </div>
        )
      )}
    </section>
  );
}
