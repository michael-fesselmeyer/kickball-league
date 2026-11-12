import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { dueReminder } from "@/domain/notifications/payment-reminders";
import { localDate } from "@/domain/scheduler/slots";
import type { PaymentReminderPayload } from "@/emails/payment-reminder";
import { league } from "../schema/league";
import { season } from "../schema/season";
import { registration } from "../schema/team";
import { enqueueMessages, type OutboxMessage } from "./outbox";
import type { Db } from "./schedule";

/** Registrations that still owe money: they have not paid, whatever else is pending. */
const UNPAID = ["pending_waiver", "pending_payment"] as const;

/**
 * Queues today's payment reminder for every unpaid registration in a season
 * whose deadline is within a week (7, 3 and 1 days before). Safe to run any
 * number of times a day: each reminder's dedupe key names the registration
 * and the milestone, so it is queued once. Returns how many were new.
 */
export async function queuePaymentReminders(
  db: Db,
  now: Date,
): Promise<number> {
  const weekOut = new Date(now.getTime() + 8 * 86_400_000);
  const seasons = await db
    .select({
      id: season.id,
      name: season.name,
      slug: season.slug,
      deadline: season.paymentDeadlineAt,
      timeZone: league.timezone,
    })
    .from(season)
    .innerJoin(league, eq(season.leagueId, league.id))
    .where(
      and(
        gt(season.paymentDeadlineAt, now),
        lte(season.paymentDeadlineAt, weekOut),
      ),
    );

  const messages: OutboxMessage[] = [];
  for (const s of seasons) {
    if (!s.deadline) continue;
    const due = dueReminder(s.deadline, now, s.timeZone);
    if (!due) continue;
    const unpaid = await db
      .select({
        id: registration.id,
        userId: registration.userId,
        status: registration.status,
      })
      .from(registration)
      .where(
        and(
          eq(registration.seasonId, s.id),
          inArray(registration.status, UNPAID),
        ),
      );
    const deadline = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: s.timeZone,
    }).format(s.deadline);
    for (const r of unpaid) {
      const payload: PaymentReminderPayload = {
        seasonName: s.name,
        seasonSlug: s.slug,
        deadline,
        daysLeft: due.daysLeft,
        needsWaiver: r.status === "pending_waiver",
      };
      messages.push({
        userId: r.userId,
        topic: "payment",
        template: "payment_reminder",
        payload,
        // Naming the deadline means a moved deadline gets its own reminders.
        dedupeKey: `payment-reminder/${r.id}/${localDate(s.deadline, s.timeZone)}/${due.milestone}d`,
        sendAfter: now,
      });
    }
  }
  return enqueueMessages(db, messages);
}
