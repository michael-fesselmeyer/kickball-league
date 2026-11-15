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
  books_nudge: {
    urgency: "non_urgent",
    label:
      "For owners: a monthly list of expected costs to confirm and receipts still missing",
  },
  books_reminder: {
    urgency: "non_urgent",
    label:
      "For owners: a permit application window, renewal, fees due date or insurance expiry coming up",
  },
  checklist_reminder: {
    urgency: "non_urgent",
    label:
      "For owners and admins: a season checklist task that is due soon or overdue",
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
  game_day_change: {
    urgency: "urgent",
    label: "Your game starts late, is called off or is back on",
  },
  game_day_decide: {
    urgency: "urgent",
    label: "A game day's decision time passed with no decision",
  },
  game_day_watch: {
    urgency: "urgent",
    label: "Weather watches before your game, if you asked for them",
  },
  gear_reminder: {
    urgency: "non_urgent",
    label:
      "The evening before a game you're bringing league gear to: which kit and where it goes",
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
  incident_filed: {
    urgency: "urgent",
    label: "For owners and admins: a report was filed for a game",
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
  private_event: {
    urgency: "urgent",
    label:
      "Your request for a private league or tournament: received, set up or declined",
  },
  payment_reminder: {
    urgency: "urgent",
    label: "Payment deadline reminders",
  },
  permit_alert: {
    urgency: "non_urgent",
    label:
      "For owners: a season near NYC Parks' 50-hour insurance line, permitted field time to give back, or games and events a permit no longer covers",
  },
  photo_review: {
    urgency: "non_urgent",
    label: "Whether the league used a photo you uploaded",
  },
  rain_alert: {
    urgency: "urgent",
    label: "Rain alerts for admins the day before games",
  },
  rain_decision: {
    urgency: "urgent",
    label: "Rain-out decision alerts for owners on game days",
  },
  rainout_notice: {
    urgency: "urgent",
    label: "Rain-outs and makeup times",
  },
  rainout_request: {
    urgency: "urgent",
    label: "Rain-outs sent to the owners to confirm",
  },
  rebate_credit: {
    urgency: "non_urgent",
    label: "League credit for rained-out games",
  },
  referee_needed: {
    urgency: "urgent",
    label: "A game starting within a day that needs a ref, for refs free then",
  },
  referral_credit: {
    urgency: "non_urgent",
    label: "League credit for a friend you referred",
  },
  rule_change: {
    urgency: "non_urgent",
    label: "A change to the league's rules, a few days before it takes effect",
  },
  score_confirmation: {
    urgency: "urgent",
    label: "Scores waiting for your confirmation",
  },
  score_dispute: {
    urgency: "urgent",
    label: "For admins: a captain disputed a reported score",
  },
  score_reminder: {
    urgency: "non_urgent",
    label: "Reminders about games with no score yet",
  },
  season_card: {
    urgency: "non_urgent",
    label: "Your season in kickball: your end-of-season card is ready",
  },
  shirt_size_reminder: {
    urgency: "non_urgent",
    label: "A reminder to pick your shirt size before the league orders shirts",
  },
  sub_request: {
    urgency: "urgent",
    label: "Teams that need a sub when you're free",
  },
  sub_update: {
    urgency: "urgent",
    label: "Answers to your sub offers",
  },
  concern_update: {
    urgency: "urgent",
    label:
      "The league's acknowledgement, reply or closing note on a concern you sent",
  },
  suspension: {
    urgency: "urgent",
    label: "A suspension, its games and how to appeal",
  },
  survey_invite: {
    urgency: "non_urgent",
    label: "An end-of-season survey for a season you played in",
  },
  team_role: {
    urgency: "non_urgent",
    label:
      "Becoming or no longer being a co-captain, and the answer to a captaincy you offered",
  },
  volunteer_reminder: {
    urgency: "non_urgent",
    label: "A reminder the day before a volunteer shift you signed up for",
  },
  waitlist_offer: {
    urgency: "urgent",
    label: "A team spot held for you from the waitlist",
  },
  win_back: {
    urgency: "non_urgent",
    label:
      "An invitation back when a new season's registration opens, if you played before",
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
