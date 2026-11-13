import type { TicketHolder } from "@/db/queries/event-tickets";
import { formatCode, priceLine } from "@/domain/events/tickets";
import { formatCents } from "@/domain/registration/pricing";
import { checkInTicketAction, refundTicketAction } from "../ticket-actions";

const control =
  "min-h-11 rounded-input border border-border-strong bg-surface px-3 text-body";

/** What a holder paid: "$15 card + $5 credit", "$10 credit" or "Free". */
function paidLine(t: TicketHolder): string {
  const parts = [
    ...(t.cardCents > 0 ? [`${formatCents(t.cardCents)} card`] : []),
    ...(t.creditCents > 0 ? [`${formatCents(t.creditCents)} credit`] : []),
  ];
  return parts.length > 0 ? parts.join(" + ") : "Free";
}

const time = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

/**
 * The admin's ticket list for a ticketed event: who holds a ticket, their
 * check-in code and what they paid, a check-in box for the door, and a
 * full refund for each ticket.
 */
export function EventTickets({
  slug,
  prices,
  capacity,
  holders,
  checkingOut,
  offered,
  timeZone,
  checkedIn,
}: {
  slug: string;
  prices: { ticketPriceCents: number | null; memberPriceCents: number | null };
  capacity: number | null;
  holders: TicketHolder[];
  checkingOut: number;
  offered: number;
  timeZone: string;
  /** The code just checked in, to name who it was. */
  checkedIn: string | null;
}) {
  const paid = holders.filter((t) => t.status === "paid");
  const refunded = holders.filter((t) => t.status === "refunded");
  const arrived = paid.filter((t) => t.checkedInAt !== null).length;
  const justIn = checkedIn ? paid.find((t) => t.code === checkedIn) : null;
  return (
    <section
      id="tickets"
      aria-labelledby="tickets-heading"
      className="flex flex-col gap-4"
    >
      <h2 id="tickets-heading" className="text-h2">
        Tickets ({paid.length}
        {capacity !== null ? ` of ${capacity}` : ""} sold)
      </h2>
      <p>
        <span className="font-bold">Price:</span> {priceLine(prices) ?? "Free"}
        {checkingOut + offered > 0 && (
          <>
            {" "}
            · {checkingOut} checking out now, {offered}{" "}
            {offered === 1 ? "offer" : "offers"} open to the waitlist
          </>
        )}
      </p>
      {justIn && (
        <p role="status" className="rounded-lg border border-success p-3">
          {justIn.name} is checked in.
        </p>
      )}

      {paid.length > 0 && (
        <form
          action={checkInTicketAction.bind(null, slug)}
          className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-4"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="check-in-code" className="font-bold">
              Check-in code
            </label>
            <input
              id="check-in-code"
              name="code"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={8}
              className={`${control} w-36 font-mono uppercase`}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Check in
          </button>
          <p className="w-full text-small text-text-muted">
            {arrived} of {paid.length} checked in.
          </p>
        </form>
      )}

      {paid.length === 0 ? (
        <p className="text-text-muted">No tickets sold yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {paid.map((t) => (
            <li
              key={t.id}
              className="flex flex-col gap-2 rounded-card border border-border p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold">{t.name}</p>
                <p className="font-mono">{formatCode(t.code)}</p>
              </div>
              <p className="text-small text-text-muted">
                {paidLine(t)}
                {t.checkedInAt
                  ? ` · Checked in at ${time(t.checkedInAt, timeZone)}`
                  : ""}
              </p>
              <details>
                <summary className="inline-flex min-h-11 cursor-pointer items-center underline">
                  Refund {t.name}
                </summary>
                <form
                  action={refundTicketAction.bind(null, slug, t.id)}
                  className="mt-2 flex flex-col items-start gap-2"
                >
                  <p className="text-small">
                    Sends back {paidLine(t).toLowerCase()} in full, cancels the
                    ticket and offers the spot to the waitlist.
                  </p>
                  <label
                    htmlFor={`reason-${t.id}`}
                    className="text-small font-bold"
                  >
                    Reason (optional)
                  </label>
                  <input
                    id={`reason-${t.id}`}
                    name="reason"
                    maxLength={200}
                    className={`${control} w-full`}
                  />
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      name="confirm"
                      value="yes"
                      required
                      className="size-5 accent-brand"
                    />
                    Yes, refund this ticket
                  </label>
                  <button type="submit" className="btn btn-secondary">
                    Refund the ticket
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}

      {refunded.length > 0 && (
        <>
          <h3 className="text-h3">Refunded ({refunded.length})</h3>
          <ul className="flex flex-col gap-1">
            {refunded.map((t) => (
              <li key={t.id}>
                {t.name}{" "}
                <span className="text-small text-text-muted">
                  ({paidLine(t)}
                  {t.refundedCents > 0
                    ? `, ${formatCents(t.refundedCents)} back on the card`
                    : ""}
                  )
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
