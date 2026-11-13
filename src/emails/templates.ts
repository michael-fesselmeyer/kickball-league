import type { Renderer } from "@/db/queries/outbox";
import type { DIGEST_KIND, MessageKind } from "@/domain/notifications/kinds";
import { err } from "@/domain/result";
import { announcementEmail } from "./announcement";
import { booksReminderEmail } from "./books-reminder";
import type { Template } from "./define";
import { digestEmail } from "./digest";
import { emailBudgetEmail } from "./email-budget";
import { eventNoticeEmail } from "./event";
import { eventTicketEmail } from "./event-ticket";
import { giveawayWinEmail } from "./giveaway";
import { instagramReconnectEmail } from "./instagram-reconnect";
import { instagramStorageFullEmail } from "./instagram-storage-full";
import type { RenderContext } from "./layout";
import { newTeamEmail } from "./new-team";
import {
  guaranteeFailedEmail,
  guaranteeWarningEmail,
  rebateCreditEmail,
  referralCreditEmail,
  waitlistOfferEmail,
} from "./money";
import { paymentReminderEmail } from "./payment-reminder";
import { rainAlertEmail } from "./rain-alert";
import { rainoutNoticeEmail } from "./rainout-notice";
import { scoreConfirmationEmail } from "./score-confirmation";
import { scoreReminderEmail } from "./score-reminder";
import { subRequestEmail, subUpdateEmail } from "./sub-request";
import { suspensionEmail } from "./suspension";

/**
 * Every email the outbox can send, by the template name stored on the
 * message row. Each kind of league message adds one, and must first say
 * whether it is urgent in MESSAGE_KINDS (src/domain/notifications/kinds.ts):
 * a name that table does not list is a type error here.
 */
const TEMPLATES: Readonly<Record<MessageKind | typeof DIGEST_KIND, Template>> =
  {
    announcement: announcementEmail,
    books_reminder: booksReminderEmail,
    digest: digestEmail,
    email_budget: emailBudgetEmail,
    event_news: eventNoticeEmail,
    event_notice: eventNoticeEmail,
    event_ticket: eventTicketEmail,
    giveaway_win: giveawayWinEmail,
    guarantee_failed: guaranteeFailedEmail,
    guarantee_warning: guaranteeWarningEmail,
    instagram_reconnect: instagramReconnectEmail,
    instagram_storage_full: instagramStorageFullEmail,
    new_team: newTeamEmail,
    payment_reminder: paymentReminderEmail,
    rain_alert: rainAlertEmail,
    rainout_notice: rainoutNoticeEmail,
    rebate_credit: rebateCreditEmail,
    referral_credit: referralCreditEmail,
    score_confirmation: scoreConfirmationEmail,
    score_reminder: scoreReminderEmail,
    sub_request: subRequestEmail,
    sub_update: subUpdateEmail,
    suspension: suspensionEmail,
    waitlist_offer: waitlistOfferEmail,
  };

const isTemplateName = (name: string): name is keyof typeof TEMPLATES =>
  Object.hasOwn(TEMPLATES, name);

/** The outbox's renderer for this site. */
export function rendererFor(context: RenderContext): Renderer {
  return (name, payload) => {
    const template = isTemplateName(name) ? TEMPLATES[name] : undefined;
    return template
      ? template(payload, context)
      : err(`No email template named ${name}`);
  };
}
