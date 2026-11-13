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
  event_notice: {
    urgency: "urgent",
    label:
      "An event spot that opened for you, or an event you RSVP'd to called off",
  },
  new_team: {
    urgency: "non_urgent",
    label: "Answers to new-team requests",
  },
  payment_reminder: {
    urgency: "urgent",
    label: "Payment deadline reminders",
  },
  rain_alert: {
    urgency: "urgent",
    label: "Rain alerts for admins the day before games",
  },
  rainout_notice: {
    urgency: "urgent",
    label: "Rain-outs and makeup times",
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
} as const satisfies Record<string, { urgency: Urgency; label: string }>;

export type MessageKind = keyof typeof MESSAGE_KINDS;

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
