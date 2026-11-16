import type { MethodQuote } from "@/domain/money/processing-fee";
import { formatCents } from "@/domain/registration/pricing";

/**
 * The total for each way to pay, shown before anyone commits (ADR 0082):
 * the card price with its fee as its own line, a bank transfer where it is
 * offered, and the lower price for cash, Zelle and check with how to use
 * them. Renders nothing while the league's processing fees are off, so the
 * pay forms stay exactly as they were.
 *
 * Inside a pay form it adds the `payMethod` choice; the free methods are
 * paid outside the app, so they are described rather than chosen.
 */
export function PayMethods({
  quotes,
  freeMethodsNote,
  adjusted,
}: {
  quotes: readonly MethodQuote[];
  /** The league's own words on who takes cash and where Zelle goes. */
  freeMethodsNote: string;
  /** Promo codes or credit may still change the total. */
  adjusted?: boolean;
}) {
  if (quotes.length === 0) return null;
  const online = quotes.filter(
    (q) => q.method === "card" || q.method === "bank",
  );
  const free = quotes.find((q) => q.method === "cash");
  const venmo = quotes.find((q) => q.method === "venmo");
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">How you&apos;ll pay online</legend>
        {online.map((q, n) => (
          <label key={q.method} className="flex min-h-11 items-start gap-3">
            <input
              className="mt-1 size-5 accent-brand"
              type="radio"
              name="payMethod"
              value={q.method}
              defaultChecked={n === 0}
            />
            <span>
              {q.label}: <strong>{formatCents(q.totalCents)}</strong>
              <span className="block text-small text-text-muted">
                {formatCents(q.totalCents - q.feeCents)} plus a{" "}
                {formatCents(q.feeCents)}{" "}
                {q.method === "card" ? "card processing fee" : "transfer fee"}
                {q.method === "bank" &&
                  ". Takes a few business days to arrive."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {free && (
        <div className="rounded-lg border border-success p-3">
          <p>
            <strong>Pay {formatCents(free.totalCents)} with no fee</strong> by
            cash, Zelle or check
            {venmo && venmo.feeCents === 0 ? ", or Venmo" : ""}.
          </p>
          {venmo && venmo.feeCents > 0 && (
            <p className="text-small text-text-muted">
              Venmo: {formatCents(venmo.totalCents)}, which covers Venmo&apos;s{" "}
              {formatCents(venmo.feeCents)} fee.
            </p>
          )}
          {freeMethodsNote && <p className="text-small">{freeMethodsNote}</p>}
          <p className="text-small text-text-muted">
            Your captain or the league records it, and you&apos;re marked paid.
          </p>
        </div>
      )}
      <p className="text-small text-text-muted">
        {adjusted
          ? "A promo code or league credit comes off first, and the fee is on what's left. "
          : ""}
        Stripe shows the exact total, with the fee on its own line, before you
        pay.
      </p>
    </div>
  );
}
