import type { MyTicket } from "@/db/queries/event-tickets";
import type { MyRsvp } from "@/db/queries/events";
import {
  formatCode,
  freeSpots,
  placeForBuyer,
  priceLine,
  type Spots,
  type TicketPrices,
  ticketPrice,
} from "@/domain/events/tickets";
import { creditToApply } from "@/domain/money/credit";
import { formatCents } from "@/domain/registration/pricing";
import { ConfirmingPayment } from "@/app/app/seasons/[season]/confirming";
import { buyTicketAction, leaveEventAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

const moment = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);

/**
 * The ticket part of a ticketed event's page: the person's ticket and
 * check-in code once paid, a checkout they left open, an offer from the
 * waitlist, their place in line, or the price and a button to buy.
 */
export function TicketPanel({
  slug,
  prices,
  member,
  ticket,
  rsvp,
  spots,
  creditCents,
  timeZone,
  returned,
}: {
  slug: string;
  prices: TicketPrices;
  member: boolean;
  ticket: MyTicket | null;
  rsvp: MyRsvp | null;
  spots: Spots;
  creditCents: number;
  timeZone: string;
  /** Back from Stripe: "paid" or "cancelled". */
  returned: string | null;
}) {
  const price = ticketPrice(prices, member) ?? 0;
  const line = priceLine(prices);

  if (ticket?.status === "paid")
    return (
      <>
        <p className="text-body-lg font-bold">You have a ticket.</p>
        <div
          aria-label="Your check-in code"
          role="group"
          className="flex flex-col items-start gap-1 rounded-card border-2 border-brand p-4"
        >
          <p className="text-small font-bold text-text-muted">Check-in code</p>
          <p className="font-mono text-h1 tracking-widest">
            {formatCode(ticket.code)}
          </p>
          <p className="text-small text-text-muted">
            {ticket.checkedInAt
              ? `Checked in at ${moment(ticket.checkedInAt, timeZone)}.`
              : "Show this at the door."}
          </p>
        </div>
        <p className="text-text-muted">
          Plans changed? Ask the league for a refund; your spot goes to the next
          person on the waitlist.
        </p>
      </>
    );

  if (returned === "paid") return <ConfirmingPayment />;

  if (rsvp?.status === "going")
    return (
      <>
        <p className="text-body-lg font-bold">You&apos;re going.</p>
        <p className="text-text-muted">
          You RSVP&apos;d before tickets went on sale, so your spot is free.
          Can&apos;t make it? Drop it so someone else gets it.
        </p>
        <form action={leaveEventAction.bind(null, slug)}>
          <SubmitButton className="btn btn-secondary">
            I can&apos;t make it
          </SubmitButton>
        </form>
      </>
    );

  if (ticket?.status === "held" && ticket.heldUntil)
    return (
      <>
        <p className="text-body-lg font-bold">Your checkout is open.</p>
        <p className="text-text-muted">
          {returned === "cancelled" ? "You left checkout before paying. " : ""}
          Your spot is held while Stripe&apos;s checkout is open, about half an
          hour from when you started.
        </p>
        <form action={buyTicketAction.bind(null, slug)}>
          <SubmitButton className="btn btn-primary">Finish paying</SubmitButton>
        </form>
      </>
    );

  const offered = ticket?.status === "offered" && ticket.heldUntil !== null;
  if (rsvp?.status === "waitlisted" && !offered)
    return (
      <>
        <p className="text-body-lg font-bold">
          You&apos;re number {rsvp.position} on the waitlist.
        </p>
        <p className="text-text-muted">
          When a spot opens, the first person in line gets a day to buy it, and
          an email.
        </p>
        <form action={leaveEventAction.bind(null, slug)}>
          <SubmitButton className="btn btn-secondary">
            Leave the waitlist
          </SubmitButton>
        </form>
      </>
    );

  const free = freeSpots(spots);
  const full = !offered && placeForBuyer(spots) === "waitlist";
  const credit = creditToApply(price, creditCents);
  return (
    <>
      {offered && ticket.heldUntil && (
        <p className="rounded-lg border-2 border-brand p-3 font-bold">
          A spot opened up and it&apos;s held for you until{" "}
          {moment(ticket.heldUntil, timeZone)}.
        </p>
      )}
      <p>
        <span className="font-bold">Tickets:</span> {line}
        {member && prices.memberPriceCents !== null
          ? ". You pay the member price."
          : ""}
      </p>
      {!offered && (
        <p className="text-text-muted">
          {free === null
            ? "No limit on this one."
            : full
              ? `All ${spots.capacity} spots are taken. Join the waitlist and you'll get a day to buy the next one that opens.`
              : `${free} of ${spots.capacity} spots left.`}
        </p>
      )}
      <form
        action={buyTicketAction.bind(null, slug)}
        className="flex flex-col items-start gap-3"
      >
        {!full && credit > 0 && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="useCredit"
              defaultChecked
              className="size-5 accent-brand"
            />
            Use {formatCents(credit)} of my league credit
          </label>
        )}
        <SubmitButton className="btn btn-primary">
          {full
            ? "Join the waitlist"
            : price === 0
              ? "Get my free ticket"
              : `Buy a ticket for ${formatCents(price)}`}
        </SubmitButton>
        {!full && price > 0 && (
          <p className="text-small text-text-muted">
            You pay securely with Stripe. Your spot is held while you check out.
          </p>
        )}
      </form>
      {offered && (
        <form action={leaveEventAction.bind(null, slug)}>
          <SubmitButton className="btn btn-secondary">Pass on it</SubmitButton>
        </form>
      )}
    </>
  );
}
