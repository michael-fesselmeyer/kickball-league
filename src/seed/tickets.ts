import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/queries/schedule";
import { creditEntry } from "@/db/schema/credit";
import { event, eventTicket } from "@/db/schema/event";
import { payment, purchase, refund } from "@/db/schema/money";
import { eventSlug, parseEventForm } from "@/domain/events/event";
import type { LeagueId } from "@/domain/ids";
import type { SeedData } from "./generate";

/**
 * A ticketed event for the demo (ADR 0027): a bowling night with a member
 * price and a capacity, so a visitor can buy a ticket with Stripe's test
 * mode. Nobody holds a ticket at first.
 */
export const SEED_BOWLING = {
  kind: "bar_night",
  title: "Spring bowling night",
  place: "Strike Lanes (demo venue), 400 Example Ave, Brooklyn",
  description:
    "Bowling, shoes and pizza. Tickets are $15, or $10 for anyone who has played a season. Spots are limited by the lanes.",
  capacity: "24",
  startsOn: "2027-03-13",
  startTime: "19:00",
  endsOn: "",
  endTime: "22:00",
} as const;

export async function addTicketDemo(db: Db, data: SeedData): Promise<void> {
  const timeZone = data.league.timezone;
  const parsed = parseEventForm(SEED_BOWLING, timeZone);
  if (!parsed.ok) throw new Error(`Seed bowling: ${parsed.error}`);
  await db.insert(event).values({
    ...parsed.value,
    leagueId: data.league.id,
    slug: eventSlug(parsed.value.title, parsed.value.startsAt, timeZone),
    ticketPriceCents: 1500,
    memberPriceCents: 1000,
  });
}

/**
 * Removes the tickets sold for a league's events and the money behind them
 * (credit used, refunds, payments and purchases), which would otherwise
 * stop the events and the people who bought from being deleted.
 */
export async function removeSeedTickets(db: Db, leagueId: LeagueId) {
  const events = db
    .select({ id: event.id })
    .from(event)
    .where(eq(event.leagueId, leagueId));
  const purchaseIds = (
    await db
      .select({ id: eventTicket.purchaseId })
      .from(eventTicket)
      .where(inArray(eventTicket.eventId, events))
  ).flatMap((t) => (t.id ? [t.id] : []));
  await db.delete(eventTicket).where(inArray(eventTicket.eventId, events));
  if (purchaseIds.length === 0) return;
  const payments = db
    .select({ id: payment.id })
    .from(payment)
    .where(inArray(payment.purchaseId, purchaseIds));
  await db
    .delete(creditEntry)
    .where(inArray(creditEntry.purchaseId, purchaseIds));
  await db.delete(refund).where(inArray(refund.paymentId, payments));
  await db.delete(payment).where(inArray(payment.purchaseId, purchaseIds));
  await db.delete(purchase).where(inArray(purchase.id, purchaseIds));
}
