/**
 * Every kind of message the outbox sends, and whether it is urgent. One
 * table, so a new kind of message has to choose: the email templates
 * (src/emails/templates.ts) are keyed by these names, and a template the
 * table does not list does not compile. docs/architecture.md, section 5
 * ("Urgent and non-urgent messages") shows the same table, and ADR 0019
 * explains the split.
 *
 * Urgent: time-critical, or about something the person is already part of
 * (rain-outs, schedule changes, a sub spot, a payment deadline, a
 * suspension). Sent at once, never held or capped; a push in quiet hours
 * arrives silently.
 *
 * Non-urgent: news and reminders that can wait. Counted against the
 * person's daily cap, held until quiet hours end, and folded into the next
 * digest once the cap is reached. Never dropped.
 */
export type Urgency = "urgent" | "non_urgent";

export const MESSAGE_KINDS = {
  announcement: {
    urgency: "non_urgent",
    label: "Announcements from admins and captains",
  },
  away_short: {
    urgency: "non_urgent",
    label:
      "For captains: a week your team may be short because players will be away",
  },
  books_reminder: {
    urgency: "non_urgent",
    label:
      "For owners: a permit application window, renewal or insurance expiry coming up",
  },
  captain_handoff: {
    urgency: "urgent",
    label: "Your team's captaincy offered to you, waiting for your answer",
  },
  email_budget: {
    urgency: "urgent",
    label: "For admins: urgent email waiting for tomorrow's email allowance",
  },
  event_news: {
    urgency: "non_urgent",
    label:
      "Event announcements, and changes or cancellations more than a day ahead",
  },
  event_notice: {
    urgency: "urgent",
    label:
      "An event spot that opened for you, or an event cancelled or moved within a day of its start",
  },
  event_ticket: {
    urgency: "urgent",
    label:
      "Your event ticket's receipt or refund, or an event spot held for you to buy by a deadline",
  },
  giveaway_win: {
    urgency: "non_urgent",
    label: "A giveaway you won at a league event",
  },
  guarantee_failed: {
    urgency: "urgent",
    label: "A captain's card guarantee that could not be charged",
  },
  guarantee_warning: {
    urgency: "urgent",
    label: "A warning before a captain's card guarantee is charged",
  },
  instagram_reconnect: {
    urgency: "non_urgent",
    label: "For admins: the Instagram connection needs reconnecting",
  },
  instagram_storage_full: {
    urgency: "non_urgent",
    label: "For admins: Instagram photo storage is full",
  },
  merch_receipt: {
    urgency: "urgent",
    label: "Your receipt for an order from the league shop",
  },
  merch_update: {
    urgency: "non_urgent",
    label: "Your league shop order is ready, or was refunded",
  },
  new_team: {
    urgency: "non_urgent",
    label: "Answers to new-team requests",
  },
  payment_reminder: {
    urgency: "urgent",
    label: "Payment deadline reminders",
  },
  photo_review: {
    urgency: "non_urgent",
    label: "Whether the league used a photo you uploaded",
  },
  rain_alert: {
    urgency: "urgent",
    label: "Rain alerts for admins the day before games",
  },
  rainout_notice: {
    urgency: "urgent",
    label: "Rain-outs and makeup times",
  },
  rebate_credit: {
    urgency: "non_urgent",
    label: "League credit for rained-out games",
  },
  referral_credit: {
    urgency: "non_urgent",
    label: "League credit for a friend you referred",
  },
  score_confirmation: {
    urgency: "urgent",
    label: "Scores waiting for your confirmation",
  },
  score_reminder: {
    urgency: "non_urgent",
    label: "Reminders about games with no score yet",
  },
  sub_request: {
    urgency: "urgent",
    label: "Teams that need a sub when you're free",
  },
  sub_update: {
    urgency: "urgent",
    label: "Answers to your sub offers",
  },
  suspension: {
    urgency: "urgent",
    label: "A suspension, its games and how to appeal",
  },
  team_role: {
    urgency: "non_urgent",
    label:
      "Becoming or no longer being a co-captain, and the answer to a captaincy you offered",
  },
  waitlist_offer: {
    urgency: "urgent",
    label: "A team spot held for you from the waitlist",
  },
} as const satisfies Record<string, { urgency: Urgency; label: string }>;

export type MessageKind = keyof typeof MESSAGE_KINDS;

/** The notice to admins that the email quota ran out (email-budget.ts). */
export const EMAIL_BUDGET_KIND = "email_budget" satisfies MessageKind;

/** How close to an event's start a cancellation or move is urgent. */
const EVENT_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Which kind an event notice is (all render with the same template). A spot
 * that opened for the person is urgent. A cancellation, or a change to the
 * time or place, is urgent within a day of the start (the earlier of the old
 * and new start when it moved). Announcements, other edits and anything
 * further ahead are news that can wait.
 */
export function eventNoticeKind({
  notice,
  startsAt,
  startedBefore,
  timeOrPlaceChanged = false,
  now,
}: {
  notice: "spot_opened" | "cancelled" | "announced" | "updated";
  startsAt: Date;
  /** The start before an edit moved it. */
  startedBefore?: Date | undefined;
  timeOrPlaceChanged?: boolean;
  now: Date;
}): "event_notice" | "event_news" {
  if (notice === "spot_opened") return "event_notice";
  const soonest = Math.min(
    startsAt.getTime(),
    startedBefore?.getTime() ?? Number.POSITIVE_INFINITY,
  );
  const soon = soonest - now.getTime() <= EVENT_SOON_MS;
  const urgent =
    soon &&
    (notice === "cancelled" || (notice === "updated" && timeOrPlaceChanged));
  return urgent ? "event_notice" : "event_news";
}

/** The digest is not a kind people get on its own: it carries the others. */
export const DIGEST_KIND = "digest";

/**
 * How the outbox treats a message: by its kind's urgency, or as the
 * digest. A template the table does not know is treated as urgent, so
 * nothing is ever held back by mistake.
 */
export type DeliveryClass = Urgency | "digest";

const isKind = (template: string): template is MessageKind =>
  Object.hasOwn(MESSAGE_KINDS, template);

export function deliveryClassOf(template: string): DeliveryClass {
  if (template === DIGEST_KIND) return "digest";
  return isKind(template) ? MESSAGE_KINDS[template].urgency : "urgent";
}

/** The kinds counted against the daily cap, for the outbox's count query. */
export const NON_URGENT_KINDS: readonly MessageKind[] = Object.entries(
  MESSAGE_KINDS,
)
  .filter(([, kind]) => kind.urgency === "non_urgent")
  .map(([name]) => name)
  .filter(isKind);

/** Labels for the settings page: what always comes at once. */
export const URGENT_LABELS: readonly string[] = Object.values(MESSAGE_KINDS)
  .filter((kind) => kind.urgency === "urgent")
  .map((kind) => kind.label);
